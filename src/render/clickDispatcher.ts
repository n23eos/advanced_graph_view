/**
 * Defers a node's single click for one double-click window, so tools like
 * Hide/Pin/Path never fire on the first half of a double-click (F-02). The
 * renderer feeds it qualifying pointer-ups; it decides what they meant.
 */

export const DOUBLE_CLICK_MS = 350;

export interface ClickDispatcherCallbacks {
	onClick(nodeId: number, event: PointerEvent): void;
	onDoubleClick(nodeId: number): void;
}

type ClickTimerWindow = Pick<Window, "setTimeout" | "clearTimeout">;

export class ClickDispatcher {
	private pending: {
		nodeId: number;
		event: PointerEvent;
		timer: number;
		timerWindow: ClickTimerWindow;
	} | null = null;

	constructor(
		private readonly callbacks: ClickDispatcherCallbacks,
		private readonly windowMs: number = DOUBLE_CLICK_MS,
		private readonly windowProvider: () => ClickTimerWindow = () => window
	) {}

	/** A completed (non-drag) click on a node. */
	press(nodeId: number, event: PointerEvent): void {
		if (this.pending?.nodeId === nodeId) {
			this.pending.timerWindow.clearTimeout(this.pending.timer);
			this.pending = null;
			this.callbacks.onDoubleClick(nodeId);
			return;
		}
		// A quick click on a different node is not a double-click: deliver the
		// previous single click right away and start a fresh window.
		this.flush();
		const timerWindow = this.windowProvider();
		const timer = timerWindow.setTimeout(() => {
			this.pending = null;
			this.callbacks.onClick(nodeId, event);
		}, this.windowMs);
		this.pending = { nodeId, event, timer, timerWindow };
	}

	/** Deliver a still-pending single click immediately. */
	flush(): void {
		if (!this.pending) return;
		const { nodeId, event, timer, timerWindow } = this.pending;
		timerWindow.clearTimeout(timer);
		this.pending = null;
		this.callbacks.onClick(nodeId, event);
	}

	/** Drop a pending click without delivering it (mode change, destroy). */
	cancel(): void {
		if (!this.pending) return;
		this.pending.timerWindow.clearTimeout(this.pending.timer);
		this.pending = null;
	}
}
