import { afterEach, expect, test, vi } from "vitest";
import type { GraphRenderer } from "../render/GraphRenderer";
import { ExploreSession } from "./ExploreSession";
import { motionMs, motionSeconds, prefersReducedMotion } from "../render/motion";

afterEach(() => vi.unstubAllGlobals());

test("Explore schedules and cancels camera frames on its renderer's captured window", () => {
	const globalFrames = { requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn() };
	vi.stubGlobal("window", globalFrames);
	let callback!: FrameRequestCallback;
	const ownerWindow = {
		requestAnimationFrame: vi.fn((next: FrameRequestCallback) => { callback = next; return 7; }),
		cancelAnimationFrame: vi.fn(),
	};
	const renderer = {
		ownerWindow,
		nodePosition: () => ({ x: 0, y: 0, z: 0 }),
		cameraPosition: { x: 0, y: 0, z: -180 },
		camera: { forward: () => [0, 0, 1] },
		placeCamera: vi.fn(),
		setExploreOverlay: vi.fn(),
	};
	const session = new ExploreSession(renderer as unknown as GraphRenderer, [[]], 0, { onFocusChanged: vi.fn() });
	expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledOnce();
	callback(0);
	expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(2);
	session.stop();
	expect(ownerWindow.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(7);
	callback(16);
	expect(ownerWindow.requestAnimationFrame).toHaveBeenCalledTimes(2);
	expect(globalFrames.requestAnimationFrame).not.toHaveBeenCalled();
	expect(globalFrames.cancelAnimationFrame).not.toHaveBeenCalled();
});

test("motion preferences can be read from the host window independently of the main window", () => {
	vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
	const ownerWindow = { matchMedia: vi.fn(() => ({ matches: true })) } as unknown as Window;
	expect(prefersReducedMotion(ownerWindow)).toBe(true);
	expect(motionSeconds(0.6, ownerWindow)).toBe(0.001);
	expect(motionMs(4000, ownerWindow)).toBe(1);
	expect(prefersReducedMotion()).toBe(false);
});
