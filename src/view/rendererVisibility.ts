interface VisibleRenderer {
	pause(): void;
	resume(): void;
	resize(): void;
}

/** Keep hidden panes off the render loop; cleanup also rejects queued events. */
export function observeRendererVisibility(host: HTMLElement, renderer: VisibleRenderer, onHidden?: () => void): () => void {
	const fallbackObserver = typeof IntersectionObserver === "undefined" ? undefined : IntersectionObserver;
	const ownerWindow = host.ownerDocument?.defaultView;
	const Observer = ownerWindow ? ownerWindow.IntersectionObserver : fallbackObserver;
	if (typeof Observer === "undefined") return () => {};
	let disconnected = false;
	const observer = new Observer((entries) => {
		if (disconnected) return;
		for (const entry of entries) {
			if (entry.target !== host) continue;
			// Edge contact can report ratio 0 at the default threshold. Treat it
			// as visible so entering the pane cannot leave a stopped ticker.
			if (entry.isIntersecting) {
				renderer.resume();
				renderer.resize();
			} else {
				renderer.pause();
				onHidden?.();
			}
		}
	});
	observer.observe(host);
	return () => {
		if (disconnected) return;
		disconnected = true;
		observer.disconnect();
	};
}
