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
	"KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE",
	"Space", "ShiftLeft", "ShiftRight",
]);
/** How far ahead of the ship a towed node is held (world units). */
const TOW_DISTANCE = 140;

export class PilotMode {
	private controller = new PilotController();
	private hud: PilotHud;
	private active = false;
	private pressed = new Set<string>();
	private prev3D = false;
	private lastTarget: number | null = null;
	private hadLock = false;
	private lookDragging = false;
	private towingId: number | null = null;
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
		this.hadLock = false;
		this.prev3D = this.renderer.camera.enabled;
		this.renderer.set3DMode(true);
		this.renderer.setPilotVisual(true);
		this.host.toggleClass("graph-insight-ui-hidden", true);
		this.host.toggleClass("graph-insight-piloting", true);
		this.toggleBtn.toggleClass("is-active", true);
		this.hud.show();

		const canvas = this.renderer.canvasEl;
		document.addEventListener("keydown", this.onKeyDown);
		document.addEventListener("keyup", this.onKeyUp);
		document.addEventListener("mousemove", this.onMouseMove);
		document.addEventListener("mouseup", this.onMouseUp);
		document.addEventListener("pointerlockchange", this.onLockChange);
		canvas?.addEventListener("mousedown", this.onMouseDown);
		canvas?.addEventListener("contextmenu", this.onContextMenu);
		canvas?.requestPointerLock?.();

		this.renderer.setPilotUpdate((dt) => {
			const moved = this.controller.update(this.renderer.camera, dt);
			this.tow();
			this.updateHud();
			return moved || this.towingId !== null;
		});
		new Notice(
			"Pilot · WASD fly · Q/E·Space up/down · right-drag or lock to look · left-hold = tractor · F = dock · Esc exit",
			5000
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
		this.lookDragging = false;

		const canvas = this.renderer.canvasEl;
		document.removeEventListener("keydown", this.onKeyDown);
		document.removeEventListener("keyup", this.onKeyUp);
		document.removeEventListener("mousemove", this.onMouseMove);
		document.removeEventListener("mouseup", this.onMouseUp);
		document.removeEventListener("pointerlockchange", this.onLockChange);
		canvas?.removeEventListener("mousedown", this.onMouseDown);
		canvas?.removeEventListener("contextmenu", this.onContextMenu);
		if (document.pointerLockElement) document.exitPointerLock();

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

	/** Refresh reticle + instrument panel from the node under the crosshair. */
	private updateHud(): void {
		const id = this.towingId ?? this.renderer.nodeInCrosshair();
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
			const id = this.renderer.nodeInCrosshair(130);
			if (id !== null) {
				this.exit(); // release the lock first, then open the note
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
		if (event.button === 2) {
			// Right button: hold-drag look (works with or without pointer lock).
			this.lookDragging = true;
			event.preventDefault();
		} else if (event.button === 0) {
			// Left button: tractor beam onto the crosshair node.
			const id = this.renderer.nodeInCrosshair(110);
			if (id !== null) {
				this.towingId = id;
				this.callbacks.beginTow(id); // warms the sim so the node follows
			}
			event.preventDefault();
		}
	};

	private onMouseUp = (event: MouseEvent): void => {
		if (event.button === 2) {
			this.lookDragging = false;
		} else if (event.button === 0 && this.towingId !== null) {
			this.callbacks.endTow(this.towingId);
			this.towingId = null; // released — stays pinned where left
		}
	};

	private onContextMenu = (event: MouseEvent): void => {
		event.preventDefault(); // right button is look, not a menu
	};

	private onMouseMove = (event: MouseEvent): void => {
		if (document.pointerLockElement || this.lookDragging) {
			this.controller.addLook(event.movementX, event.movementY);
		}
	};

	/** Track lock; if it was granted and later lost (Esc), leave pilot mode. */
	private onLockChange = (): void => {
		if (document.pointerLockElement) {
			this.hadLock = true;
		} else if (this.active && this.hadLock) {
			this.exit();
		}
	};

	private updateIntent(): void {
		const k = this.pressed;
		const axis = (neg: string, pos: string): number => (k.has(neg) ? -1 : 0) + (k.has(pos) ? 1 : 0);
		this.controller.setIntent({
			forward: axis("KeyS", "KeyW"),
			strafe: axis("KeyA", "KeyD"),
			// E / Space = up, Q = down.
			lift: axis("KeyQ", "KeyE") + (k.has("Space") ? 1 : 0),
			boost: k.has("ShiftLeft") || k.has("ShiftRight"),
		});
	}
}
