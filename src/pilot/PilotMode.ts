/**
 * Pilot mode: an opt-in "fly your graph as a starship" layer over the existing
 * 3D view. Owns the top-right toggle, mouse-look, WASD flight, a tractor beam
 * that tows nodes, and docking (open a note). Shows/hides the analysis UI on
 * enter/exit. It only writes note positions (via pins); never note text.
 *
 * Look works two ways so steering is never stuck: pointer-lock free-look when
 * the browser grants it, and always hold-right-mouse-drag as a fallback.
 *
 * Movement physics live in PilotController; this class is input + lifecycle.
 */
import { Notice } from "obsidian";
import { PilotController } from "./PilotController";
import { PilotHud, type PilotTarget } from "../ui/PilotHud";
import type { GraphRenderer } from "../render/GraphRenderer";

export interface PilotCallbacks {
	onChange(active: boolean): void;
	/** Instrument-panel info for the node under the crosshair. */
	nodeInfo(id: number): PilotTarget | null;
	/** First ~300 words of the note, for the instrument preview. */
	notePreview(id: number): Promise<string | null>;
	/** Grab a node with the tractor beam (warms the simulation). */
	beginTow(id: number): void;
	/** Tow: pin a node to a world point (repeated while the beam is on). */
	pinNode(id: number, x: number, y: number, z: number): void;
	/** Release the tractor beam; the node stays where it was left. */
	endTow(id: number): void;
	/** Dock: open the note for a node. */
	openNode(id: number): void;
}

/** Held keys that steer the ship; preventDefault so the page never scrolls. */
const FLIGHT_KEYS = new Set([
	"KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE", "KeyC",
	"Space", "ShiftLeft", "ShiftRight", "ControlLeft",
]);
/** How far ahead of the ship a towed node is held (world units). */
const TOW_DISTANCE = 140;
/** Fraction of the half-screen where the crosshair aims freely without turning. */
const AIM_DEADZONE = 0.3;
/** Max turn rates when the crosshair is pushed to the edge (radians/second). */
const MAX_YAW_RATE = 1.8;
const MAX_PITCH_RATE = 1.4;

export class PilotMode {
	private controller = new PilotController();
	private hud: PilotHud;
	private active = false;
	private pressed = new Set<string>();
	private prev3D = false;
	private lastTarget: number | null = null;
	private towingId: number | null = null;
	/** Free crosshair position in canvas coordinates. */
	private cursorX = 0;
	private cursorY = 0;
	private toggleBtn: HTMLElement;

	constructor(
		private readonly host: HTMLElement,
		private readonly renderer: GraphRenderer,
		private readonly callbacks: PilotCallbacks
	) {
		this.hud = new PilotHud(host);
		this.toggleBtn = host.createEl("button", { cls: "graph-insight-pilot-toggle", text: "🚀" });
		this.toggleBtn.setAttribute("aria-label", "Pilot mode — fly the 3D graph");
		this.toggleBtn.addEventListener("click", () => this.toggle());
	}

	get isActive(): boolean {
		return this.active;
	}

	toggle(): void {
		if (this.active) this.exit();
		else this.enter();
	}

	enter(): void {
		if (this.active) return;
		this.active = true;
		this.prev3D = this.renderer.camera.enabled;
		this.renderer.set3DMode(true);
		this.renderer.setPilotVisual(true);
		this.host.toggleClass("graph-insight-ui-hidden", true);
		this.host.toggleClass("graph-insight-piloting", true);
		this.toggleBtn.toggleClass("is-active", true);
		this.hud.show();

		// Start the crosshair at the middle of the canvas.
		const canvas = this.renderer.canvasEl;
		this.cursorX = (canvas?.clientWidth ?? 0) / 2;
		this.cursorY = (canvas?.clientHeight ?? 0) / 2;

		document.addEventListener("keydown", this.onKeyDown);
		document.addEventListener("keyup", this.onKeyUp);
		document.addEventListener("mousemove", this.onMouseMove);
		document.addEventListener("mouseup", this.onMouseUp);
		canvas?.addEventListener("mousedown", this.onMouseDown);
		canvas?.addEventListener("contextmenu", this.onContextMenu);

		this.renderer.setPilotUpdate((dt) => {
			this.steer();
			const moved = this.controller.update(this.renderer.camera, dt);
			this.tow();
			this.updateHud();
			return moved || this.towingId !== null;
		});
		new Notice(
			"Pilot · aim with the crosshair · push to edges to turn · WASD move · Space/C up/down · left-hold tractor · F open · Esc",
			6000
		);
		this.callbacks.onChange(true);
	}

	exit(): void {
		if (!this.active) return;
		this.active = false;
		this.renderer.setPilotUpdate(null);
		this.controller.reset();
		this.pressed.clear();
		this.lastTarget = null;
		this.towingId = null;

		const canvas = this.renderer.canvasEl;
		document.removeEventListener("keydown", this.onKeyDown);
		document.removeEventListener("keyup", this.onKeyUp);
		document.removeEventListener("mousemove", this.onMouseMove);
		document.removeEventListener("mouseup", this.onMouseUp);
		canvas?.removeEventListener("mousedown", this.onMouseDown);
		canvas?.removeEventListener("contextmenu", this.onContextMenu);

		this.hud.hide();
		this.renderer.setPilotVisual(false);
		this.host.toggleClass("graph-insight-ui-hidden", false);
		this.host.toggleClass("graph-insight-piloting", false);
		this.toggleBtn.toggleClass("is-active", false);
		if (!this.prev3D) this.renderer.set3DMode(false);
		this.callbacks.onChange(false);
	}

	destroy(): void {
		this.exit();
		this.hud.destroy();
		this.toggleBtn.remove();
	}

	/** While the beam is on, hold the towed node a fixed distance ahead. */
	private tow(): void {
		if (this.towingId === null) return;
		const c = this.renderer.camera;
		const [fx, fy, fz] = c.forward();
		this.callbacks.pinNode(
			this.towingId,
			c.px + fx * TOW_DISTANCE,
			c.py + fy * TOW_DISTANCE,
			c.pz + fz * TOW_DISTANCE
		);
	}

	/** Turn the ship only when the crosshair is pushed past the deadzone; the
	 *  centre zone leaves aiming free. Also parks the HUD crosshair. */
	private steer(): void {
		const canvas = this.renderer.canvasEl;
		if (!canvas) return;
		const halfW = canvas.clientWidth / 2 || 1;
		const halfH = canvas.clientHeight / 2 || 1;
		this.hud.setCrosshair(this.cursorX, this.cursorY);
		this.controller.setLookRate(
			edgeRate((this.cursorX - halfW) / halfW) * MAX_YAW_RATE,
			edgeRate((this.cursorY - halfH) / halfH) * MAX_PITCH_RATE
		);
	}

	/** Refresh reticle + instrument panel from the node under the crosshair. */
	private updateHud(): void {
		const id = this.towingId ?? this.renderer.nodeAtCanvasPoint(this.cursorX, this.cursorY);
		this.hud.setReticle(id !== null ? this.renderer.nodeScreenPos(id) : null, this.towingId !== null);
		if (id !== this.lastTarget) {
			this.lastTarget = id;
			this.hud.setTarget(id !== null ? this.callbacks.nodeInfo(id) : null);
			this.hud.setPreview("");
			if (id !== null) {
				void this.callbacks.notePreview(id).then((text) => {
					// Ignore if the crosshair already moved to another node.
					if (this.active && this.lastTarget === id) this.hud.setPreview(text ?? "");
				});
			}
		}
		this.hud.setThrottle(this.controller.currentThrottle());
	}

	private onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			this.exit();
			return;
		}
		if (event.code === "KeyF") {
			const id = this.renderer.nodeAtCanvasPoint(this.cursorX, this.cursorY, 60);
			if (id !== null) {
				this.exit();
				this.callbacks.openNode(id);
			}
			return;
		}
		this.pressed.add(event.code);
		if (FLIGHT_KEYS.has(event.code)) {
			event.preventDefault();
			this.updateIntent();
		}
	};

	private onKeyUp = (event: KeyboardEvent): void => {
		this.pressed.delete(event.code);
		this.updateIntent();
	};

	private onMouseDown = (event: MouseEvent): void => {
		if (event.button !== 0) return;
		// Left button: tractor beam onto the node under the crosshair.
		const id = this.renderer.nodeAtCanvasPoint(this.cursorX, this.cursorY, 60);
		if (id !== null) {
			this.towingId = id;
			this.callbacks.beginTow(id); // warms the sim so the node follows
		}
		event.preventDefault();
	};

	private onMouseUp = (event: MouseEvent): void => {
		if (event.button === 0 && this.towingId !== null) {
			this.callbacks.endTow(this.towingId);
			this.towingId = null; // released — stays pinned where left
		}
	};

	private onContextMenu = (event: MouseEvent): void => {
		event.preventDefault(); // no context menu while flying
	};

	/** Free crosshair: the mouse moves it around the canvas; it is not pinned
	 *  to the centre. Pushing it to an edge turns the ship (see steer()). */
	private onMouseMove = (event: MouseEvent): void => {
		const canvas = this.renderer.canvasEl;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		this.cursorX = clamp(event.clientX - rect.left, 0, canvas.clientWidth);
		this.cursorY = clamp(event.clientY - rect.top, 0, canvas.clientHeight);
	};

	private updateIntent(): void {
		const k = this.pressed;
		const axis = (neg: string, pos: string): number => (k.has(neg) ? -1 : 0) + (k.has(pos) ? 1 : 0);
		const up = k.has("Space") || k.has("KeyE") ? 1 : 0;
		const down = k.has("KeyC") || k.has("KeyQ") || k.has("ControlLeft") ? 1 : 0;
		this.controller.setIntent({
			forward: axis("KeyS", "KeyW"),
			strafe: axis("KeyA", "KeyD"),
			lift: up - down,
			boost: k.has("ShiftLeft") || k.has("ShiftRight"),
		});
	}
}

/** Map a −1..1 offset to a turn factor: zero inside the deadzone, ramping to
 *  ±1 at the edge. */
function edgeRate(offset: number): number {
	const mag = Math.abs(offset);
	if (mag <= AIM_DEADZONE) return 0;
	const scaled = (mag - AIM_DEADZONE) / (1 - AIM_DEADZONE);
	return Math.sign(offset) * Math.min(1, scaled);
}

function clamp(value: number, lo: number, hi: number): number {
	return value < lo ? lo : value > hi ? hi : value;
}
