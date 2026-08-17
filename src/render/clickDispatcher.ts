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

export class ClickDispatcher {
	private pending: { nodeId: number; event: PointerEvent; timer: number } | null = null;

	constructor(
		private readonly callbacks: ClickDispatcherCallbacks,
		private readonly windowMs: number = DOUBLE_CLICK_MS
	) {}

	/** A completed (non-drag) click on a node. */
	press(nodeId: number, event: PointerEvent): void {
		if (this.pending?.nodeId === nodeId) {
			window.clearTimeout(this.pending.timer);
			this.pending = null;
			this.callbacks.onDoubleClick(nodeId);
			return;
		}
		// A quick click on a different node is not a double-click: deliver the
		// previous single click right away and start a fresh window.
		this.flush();
		const timer = window.setTimeout(() => {
			this.pending = null;
			this.callbacks.onClick(nodeId, event);
		}, this.windowMs);
		this.pending = { nodeId, event, timer };
	}

	/** Deliver a still-pending single click immediately. */
	flush(): void {
		if (!this.pending) return;
		const { nodeId, event, timer } = this.pending;
		window.clearTimeout(timer);
		this.pending = null;
		this.callbacks.onClick(nodeId, event);
	}

	/** Drop a pending click without delivering it (mode change, destroy). */
	cancel(): void {
		if (!this.pending) return;
		window.clearTimeout(this.pending.timer);
		this.pending = null;
	}
}
