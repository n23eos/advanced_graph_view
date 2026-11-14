// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { observeRendererVisibility } from "./rendererVisibility";

test("hiding a graph clears its native preview and detached observer notifications are ignored", () => {
	let callback!: IntersectionObserverCallback;
	const previous = window.IntersectionObserver;
	window.IntersectionObserver = class {
		constructor(cb: IntersectionObserverCallback) { callback = cb; }
		observe(): void {}
		disconnect(): void {}
	} as unknown as typeof IntersectionObserver;
	const host = document.body;
	const renderer = { pause: vi.fn(), resume: vi.fn(), resize: vi.fn() };
	const clear = vi.fn();
	try {
		const dispose = observeRendererVisibility(host, renderer, clear);
		const hidden = [{ target: host, isIntersecting: false }] as unknown as IntersectionObserverEntry[];
		callback(hidden, {} as IntersectionObserver);
		expect(renderer.pause).toHaveBeenCalledOnce();
		expect(clear).toHaveBeenCalledOnce();
		dispose();
		callback(hidden, {} as IntersectionObserver);
		expect(clear).toHaveBeenCalledOnce();
	} finally { window.IntersectionObserver = previous; }
});
