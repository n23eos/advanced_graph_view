/**
 * Reserve space using the actual floating controls, including wrapped search
 * chips and focus breadcrumbs. The canvas never needs to be rebuilt.
 */
type WindowWithResizeObserver = Window & { ResizeObserver?: typeof ResizeObserver };

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }

/** Never lift the corner widget further than this, whatever a theme does. */
const MAX_CORNER_INSET = 80;

/**
 * How far Obsidian's status bar reaches up into the bottom-right corner of
 * the graph. The default theme floats the bar over that corner instead of
 * reserving a row for it, so whatever the camera widget puts on its last line
 * ends up underneath. Zero when the bar is hidden, docked below the view, or
 * the graph sits in a pane the bar does not touch.
 */
export function statusBarInset(host: Box, bar: Box | null): number {
	if (!bar || bar.width <= 0 || bar.height <= 0) return 0;
	const overlapsRightEdge = bar.left < host.right && bar.right > host.right - 40;
	const reachesIn = bar.top < host.bottom && bar.bottom > host.top;
	if (!overlapsRightEdge || !reachesIn) return 0;
	return Math.min(MAX_CORNER_INSET, Math.max(0, Math.ceil(host.bottom - bar.top)));
}

export class FloatingLayout {
	private observer: ResizeObserver | null = null;
	private readonly ownerWindow: Window;

	constructor(private readonly host: HTMLElement, private readonly onWidth: (width: number) => void) {
		const ownerWindow = host.ownerDocument.defaultView;
		if (!ownerWindow) throw new Error("Floating layout host must belong to a window");
		this.ownerWindow = ownerWindow;
		this.update();
		const ResizeObserverConstructor = (this.ownerWindow as WindowWithResizeObserver).ResizeObserver;
		if (!ResizeObserverConstructor) return;
		this.observer = new ResizeObserverConstructor(() => this.update());
		this.observer.observe(host);
		for (const selector of [
			".graph-insight-topbar", ".graph-insight-toolbar",
			".graph-insight-camera", ".graph-insight-timeline",
		]) {
			const element = host.querySelector(selector);
			if (element) this.observer.observe(element);
		}
		// The bar grows and shrinks with its items (word count, sync state).
		const statusBar = host.ownerDocument.querySelector(".status-bar");
		if (statusBar) this.observer.observe(statusBar);
	}

	private update(): void {
		this.onWidth(this.host.clientWidth);
		const height = (selector: string): number =>
			this.host.querySelector(selector)?.getBoundingClientRect().height ?? 0;
		const top = height(".graph-insight-topbar");
		const inset = statusBarInset(
			this.host.getBoundingClientRect(),
			this.host.ownerDocument.querySelector(".status-bar")?.getBoundingClientRect() ?? null
		);
		const bottom = Math.max(height(".graph-insight-toolbar"), height(".graph-insight-camera") + inset);
		const timeline = height(".graph-insight-timeline");
		this.host.setCssProps({
			"--graph-topbar-bottom": `${Math.ceil(top) + 20}px`,
			"--graph-bottom-controls": `${Math.ceil(bottom) + 20}px`,
			"--graph-timeline-space": `${timeline > 0 ? Math.ceil(timeline) + 8 : 0}px`,
			"--graph-corner-inset": `${inset}px`,
		});
	}

	destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
