/**
 * Pilot mode: an opt-in "fly your graph as a starship" layer over the existing
 * 3D view. Owns the top-right toggle, pointer-lock mouse-look, WASD flight, and
 * shows/hides the analysis UI on enter/exit. It never writes to the vault.
 *
 * Movement physics live in PilotController; this class is only wiring: input
 * capture, lifecycle, and driving the renderer's per-frame hook.
 */
import { Notice } from "obsidian";
import { PilotController } from "./PilotController";
import type { GraphRenderer } from "../render/GraphRenderer";

export interface PilotCallbacks {
	onChange(active: boolean): void;
}

/** Held keys that steer the ship; preventDefault so the page never scrolls. */
const FLIGHT_KEYS = new Set([
	"KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE",
	"Space", "ShiftLeft", "ShiftRight",
]);

export class PilotMode {
	private controller = new PilotController();
	private active = false;
	private pressed = new Set<string>();
	/** 3D on/off before entering, so exit restores the prior view. */
	private prev3D = false;
	private toggleBtn: HTMLElement;

	constructor(
		private readonly host: HTMLElement,
		private readonly renderer: GraphRenderer,
		private readonly callbacks: PilotCallbacks
	) {
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
		this.host.toggleClass("graph-insight-ui-hidden", true);
		this.host.toggleClass("graph-insight-piloting", true);
		this.toggleBtn.toggleClass("is-active", true);

		document.addEventListener("keydown", this.onKeyDown);
		document.addEventListener("keyup", this.onKeyUp);
		document.addEventListener("mousemove", this.onMouseMove);
		document.addEventListener("pointerlockchange", this.onLockChange);
		this.host.requestPointerLock?.();

		this.renderer.setPilotUpdate((dt) => this.controller.update(this.renderer.camera, dt));
		new Notice("Pilot mode · WASD fly · Q/E down/up · mouse look · Esc exit", 4000);
		this.callbacks.onChange(true);
	}

	exit(): void {
		if (!this.active) return;
		this.active = false;
		this.renderer.setPilotUpdate(null);
		this.controller.reset();
		this.pressed.clear();

		document.removeEventListener("keydown", this.onKeyDown);
		document.removeEventListener("keyup", this.onKeyUp);
		document.removeEventListener("mousemove", this.onMouseMove);
		document.removeEventListener("pointerlockchange", this.onLockChange);
		if (document.pointerLockElement) document.exitPointerLock();

		this.host.toggleClass("graph-insight-ui-hidden", false);
		this.host.toggleClass("graph-insight-piloting", false);
		this.toggleBtn.toggleClass("is-active", false);
		if (!this.prev3D) this.renderer.set3DMode(false);
		this.callbacks.onChange(false);
	}

	destroy(): void {
		this.exit();
		this.toggleBtn.remove();
	}

	private onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			this.exit();
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

	private onMouseMove = (event: MouseEvent): void => {
		// Only trust movement deltas while the pointer is locked.
		if (document.pointerLockElement) this.controller.addLook(event.movementX, event.movementY);
	};

	/** Browser released the lock (Esc, focus loss) — leave pilot mode. */
	private onLockChange = (): void => {
		if (this.active && !document.pointerLockElement) this.exit();
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
