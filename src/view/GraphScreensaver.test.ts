// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import type { GraphRenderer } from "../render/GraphRenderer";
import { GraphScreensaver } from "./GraphScreensaver";

beforeAll(() => installObsidianDom());

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

async function setup(reduceMotion = false) {
	const host = document.body.createDiv();
	let fullscreen: Element | null = null;
	Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
	host.requestFullscreen = () => {
		fullscreen = host;
		return Promise.resolve();
	};
	document.exitFullscreen = () => {
		fullscreen = null;
		return Promise.resolve();
	};

	let frame: FrameRequestCallback = () => {};
	let now = 0;
	const renderer = {
		ownerWindow: {
			matchMedia: () => ({ matches: reduceMotion }),
			requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }),
			cancelAnimationFrame: vi.fn(),
		},
		camera: { enabled: true, focal: 800, yaw: 0.3, pitch: 0.2, tx: 0, ty: 0, tz: 0, px: 0, py: 0, pz: -2000 },
		set3DMode: vi.fn(), resize: vi.fn(),
		restoreCameraState: vi.fn(),
		setExploreOverlay: vi.fn(),
		setPresentationLinks: vi.fn<(emphasis: number | null) => void>(),
		playPresentationPulse: vi.fn(),
		orbitPresentation: vi.fn(),
		isPresentationNodeVisible: () => true,
		nodeNearestToViewCenter: () => 0,
		nodePosition: (id: number) => ({ x: 750 + id * 250, y: 0, z: 0 }),
	};
	const saved = { viewport: { centerX: 0, centerY: 0, scale: 1, referenceScale: 1 },
		camera3d: { position: { x: 0, y: 0, z: -2000 }, pivot: { x: 0, y: 0, z: 0 }, yaw: 0.3, pitch: 0.2 } };
	const onStop = vi.fn();
	const saver = new GraphScreensaver(host, renderer as unknown as GraphRenderer, saved,
		() => ({ links: [[1], [0]], names: ["First", "Second"] }), onStop);
	await saver.start();
	function advance(duration: number): void {
		for (const remaining of Array.from({ length: Math.ceil(duration / 50) }, (_, index) => duration - index * 50)) {
			now += Math.min(50, remaining);
			frame(now);
		}
	}
	frame(now);
	return { renderer, saver, host, advance, saved, onStop };
}

test("flies from the current camera and reveals the next note only on arrival", async () => {
	const { renderer, advance, host, saver, saved, onStop } = await setup();

	expect(renderer.orbitPresentation.mock.calls[0]).toEqual([{ x: 0, y: 0, z: 0 }, 2000, 0.3, 0.2]);
	advance(2500);
	expect(renderer.setExploreOverlay).not.toHaveBeenCalled();
	advance(100);
	expect(renderer.playPresentationPulse).toHaveBeenLastCalledWith(0, [1]);

	advance(6700);
	expect(host.querySelector(".graph-insight-screensaver-title")?.textContent).toBe("First");
	expect(renderer.setPresentationLinks).toHaveBeenLastCalledWith(0);
	advance(1300);
	expect(renderer.playPresentationPulse).toHaveBeenLastCalledWith(1, [0]);
	expect(host.querySelector(".graph-insight-screensaver-title")?.textContent).toBe("Second");

	host.querySelector("button")?.click();
	const frames = renderer.orbitPresentation.mock.calls.length;
	advance(1000);
	expect(renderer.orbitPresentation.mock.calls).toHaveLength(frames);
	expect(renderer.playPresentationPulse).toHaveBeenLastCalledWith(null);

	saver.stop();
	expect(renderer.restoreCameraState).toHaveBeenCalledExactlyOnceWith(saved);
	expect(renderer.setPresentationLinks).toHaveBeenLastCalledWith(null);
	expect(onStop).toHaveBeenCalledOnce();
});

test("reveals immediately and keeps the camera still under reduced motion", async () => {
	const { renderer, advance, saver, host } = await setup(true);
	expect(host.querySelector(".graph-insight-screensaver-title")?.textContent).toBe("First");
	advance(1000);
	expect(renderer.orbitPresentation).toHaveBeenCalledOnce();
	expect(renderer.playPresentationPulse).not.toHaveBeenCalled();
	saver.stop();
});
