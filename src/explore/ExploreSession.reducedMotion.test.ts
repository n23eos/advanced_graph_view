import { afterEach, describe, expect, test, vi } from "vitest";
import type { GraphRenderer } from "../render/GraphRenderer";
import { motionSeconds } from "../render/motion";
import { ExploreSession } from "./ExploreSession";
import type { Vec3 } from "./cameraFlight";

afterEach(() => vi.unstubAllGlobals());

function setup(reducedMotion: boolean) {
	let nextFrame = 0;
	const frames = new Map<number, FrameRequestCallback>();
	vi.stubGlobal("window", {
		matchMedia: () => ({ matches: reducedMotion }),
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			frames.set(++nextFrame, callback);
			return nextFrame;
		},
		cancelAnimationFrame: (id: number) => frames.delete(id),
	});
	const nodes: Vec3[] = [{ x: 10, y: 20, z: 30 }, { x: 110, y: 20, z: 30 }];
	let cameraPosition: Vec3 = { x: 0, y: 0, z: 0 };
	const placeCamera = vi.fn((position: Vec3, _pivot: Vec3) => { cameraPosition = position; });
	const renderer = {
		get cameraPosition() { return cameraPosition; },
		camera: { forward: () => [0, 0, 1] },
		nodePosition: (id: number) => nodes[id] ?? null,
		placeCamera,
		setExploreOverlay: vi.fn(),
	};
	const onFocusChanged = vi.fn();
	const session = new ExploreSession(
		renderer as unknown as GraphRenderer,
		[[1], [0]],
		0,
		{ onFocusChanged },
		{ flightSeconds: motionSeconds(0.6) }
	);
	const frame = (time: number) => {
		const queued = [...frames.values()];
		frames.clear();
		for (const callback of queued) callback(time);
	};
	return { session, frame, frames, placeCamera, onFocusChanged, nodes };
}

describe("Explore reduced motion", () => {
	test("places the entry camera at its destination before the first animation frame", () => {
		const { session, frame, placeCamera, nodes } = setup(true);
		try {
			expect(placeCamera).toHaveBeenCalledOnce();
			const [position, pivot] = placeCamera.mock.lastCall!;
			expect(position).toMatchObject({ x: 10, y: 20 });
			expect(position.z).toBeCloseTo(-85);
			expect(pivot).toEqual(nodes[0]);
			frame(0);
			frame(16);
			expect(placeCamera).toHaveBeenCalledOnce();
		} finally {
			session.stop();
		}
	});

	test("cuts each hop directly to the target and preserves the previous standing distance", () => {
		const { session, frame, placeCamera, onFocusChanged, nodes } = setup(true);
		try {
			frame(0);
			placeCamera.mockClear();
			session.aimAt(1);
			session.jump();
			frame(16);
			expect(placeCamera).toHaveBeenCalledOnce();
			const [position, pivot] = placeCamera.mock.lastCall!;
			expect(position).toMatchObject({ x: 110, y: 20 });
			expect(position.z).toBeCloseTo(-85);
			expect(pivot).toEqual(nodes[1]);
			frame(32);
			expect(session.currentId).toBe(1);
			expect(onFocusChanged).toHaveBeenLastCalledWith(1, [0]);
			expect(placeCamera).toHaveBeenCalledOnce();
		} finally {
			session.stop();
		}
	});

	test("keeps intermediate camera positions for ordinary motion", () => {
		const { session, frame, placeCamera, frames } = setup(false);
		try {
			expect(placeCamera).not.toHaveBeenCalled();
			frame(0);
			frame(100);
			const position = placeCamera.mock.lastCall![0];
			expect(position.x).toBeGreaterThan(0);
			expect(position.x).toBeLessThan(10);
			expect(position.z).toBeGreaterThan(-85);
			expect(position.z).toBeLessThan(0);
		} finally {
			session.stop();
		}
		expect(frames.size).toBe(0);
	});
});
