import { afterEach, describe, expect, test, vi } from "vitest";
import { observeRendererVisibility } from "./rendererVisibility";

function setup() {
	let callback!: IntersectionObserverCallback;
	const observer = { observe: vi.fn(), disconnect: vi.fn() };
	vi.stubGlobal("IntersectionObserver", class {
		observe = observer.observe;
		disconnect = observer.disconnect;
		constructor(onChange: IntersectionObserverCallback) { callback = onChange; }
	});
	const host = {} as HTMLElement;
	const renderer = { pause: vi.fn(), resume: vi.fn(), resize: vi.fn() };
	const stop = observeRendererVisibility(host, renderer);
	const notify = (isIntersecting: boolean, intersectionRatio = isIntersecting ? 1 : 0) => callback(
		[{ target: host, isIntersecting, intersectionRatio } as unknown as IntersectionObserverEntry],
		observer as unknown as IntersectionObserver
	);
	return { host, renderer, observer, stop, notify };
}

describe("renderer visibility observer", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("pauses a hidden pane and resumes then resizes when it becomes visible", () => {
		const { host, renderer, observer, notify } = setup();
		expect(observer.observe).toHaveBeenCalledWith(host);

		notify(false);
		expect(renderer.pause).toHaveBeenCalledOnce();
		expect(renderer.resume).not.toHaveBeenCalled();

		notify(true);
		expect(renderer.resume).toHaveBeenCalledOnce();
		expect(renderer.resize).toHaveBeenCalledOnce();
		expect(renderer.resume.mock.invocationCallOrder[0]).toBeLessThan(renderer.resize.mock.invocationCallOrder[0]);
	});

	test("resumes at edge contact even when the intersection ratio is zero", () => {
		const { renderer, notify } = setup();
		notify(true, 0);
		expect(renderer.pause).not.toHaveBeenCalled();
		expect(renderer.resume).toHaveBeenCalledOnce();
	});

	test("disconnects on cleanup and ignores already queued callbacks", () => {
		const { renderer, observer, stop, notify } = setup();
		stop();
		stop();
		notify(true);
		notify(false);

		expect(observer.disconnect).toHaveBeenCalledOnce();
		expect(renderer.pause).not.toHaveBeenCalled();
		expect(renderer.resume).not.toHaveBeenCalled();
		expect(renderer.resize).not.toHaveBeenCalled();
	});

	test("keeps rendering when the environment has no visibility observer", () => {
		vi.stubGlobal("IntersectionObserver", undefined);
		const renderer = { pause: vi.fn(), resume: vi.fn(), resize: vi.fn() };
		const stop = observeRendererVisibility({} as HTMLElement, renderer);
		expect(() => stop()).not.toThrow();
		expect(renderer.pause).not.toHaveBeenCalled();
	});
});
