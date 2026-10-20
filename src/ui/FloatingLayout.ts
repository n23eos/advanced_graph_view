/**
 * Reserve space using the actual floating controls, including wrapped search
 * chips and focus breadcrumbs. The canvas never needs to be rebuilt.
 */
export class FloatingLayout {
	private observer: ResizeObserver | null = null;

	constructor(private readonly host: HTMLElement, private readonly onWidth: (width: number) => void) {
		this.update();
		if (typeof ResizeObserver === "undefined") return;
		this.observer = new ResizeObserver(() => this.update());
		this.observer.observe(host);
		for (const selector of [
			".graph-insight-topbar", ".graph-insight-toolbar",
			".graph-insight-camera", ".graph-insight-timeline",
		]) {
			const element = host.querySelector(selector);
			if (element) this.observer.observe(element);
		}
	}

	private update(): void {
		this.onWidth(this.host.clientWidth);
		const height = (selector: string): number =>
			this.host.querySelector(selector)?.getBoundingClientRect().height ?? 0;
		const top = height(".graph-insight-topbar");
		const bottom = Math.max(height(".graph-insight-toolbar"), height(".graph-insight-camera"));
		const timeline = height(".graph-insight-timeline");
		this.host.setCssProps({
			"--graph-topbar-bottom": `${Math.ceil(top) + 20}px`,
			"--graph-bottom-controls": `${Math.ceil(bottom) + 20}px`,
			"--graph-timeline-space": `${timeline > 0 ? Math.ceil(timeline) + 8 : 0}px`,
		});
	}

	destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
