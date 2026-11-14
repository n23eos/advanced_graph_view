import { afterEach, describe, expect, test, vi } from "vitest";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

interface VisibilityHarness {
	app: { ticker: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } } | null;
	positions3: Float32Array | null;
	targetPositions3: Float32Array | null;
	hasWorkerFrame: boolean;
	smoothing: boolean;
	destroyed: boolean;
	contextLost: boolean;
	reproject: ReturnType<typeof vi.fn>;
}

function setup() {
	const renderer = new GraphRenderer({} as RendererCallbacks);
	const state = renderer as unknown as VisibilityHarness;
	const ticker = { start: vi.fn(), stop: vi.fn() };
	state.app = { ticker };
	state.reproject = vi.fn();
	return { renderer, state, ticker };
}

describe("GraphRenderer visibility", () => {
	afterEach(() => vi.restoreAllMocks());

	test("pauses its ticker and resumes with a fresh projection", () => {
		const { renderer, state, ticker } = setup();
		renderer.updatePositions(new Float32Array([1, 2, 3]));
		state.reproject.mockClear();

		renderer.pause();
		expect(ticker.stop).toHaveBeenCalledOnce();
		expect(ticker.start).not.toHaveBeenCalled();

		renderer.resume();
		expect(state.reproject).toHaveBeenCalledOnce();
		expect(ticker.start).toHaveBeenCalledOnce();
		expect(state.reproject.mock.invocationCallOrder[0]).toBeLessThan(ticker.start.mock.invocationCallOrder[0]);
	});

	test("adopts a pending smoothing target on pause so persistence sees the latest frame", () => {
		const { renderer, state } = setup();
		renderer.updatePositions(new Float32Array([1, 2, 3]));
		const latest = new Float32Array([7, 8, 9]);
		renderer.updatePositions(latest);
		expect(state.smoothing).toBe(true);
		state.reproject.mockClear();

		renderer.pause();

		expect(renderer.currentPositions).toEqual(latest);
		expect(renderer.currentPositions).not.toBe(latest);
		expect(state.smoothing).toBe(false);
		expect(state.reproject).not.toHaveBeenCalled();
	});

	test("keeps only the latest hidden worker frame ready for saving and the first resumed frame", () => {
		const { renderer, state } = setup();
		renderer.pause();
		renderer.updatePositions(new Float32Array([1, 2, 3]));
		const latest = new Float32Array([7, 8, 9]);
		renderer.updatePositions(latest);

		expect(renderer.currentPositions).toEqual(latest);
		expect(renderer.currentPositions).not.toBe(latest);
		expect(state.targetPositions3).toBe(latest);
		expect(state.hasWorkerFrame).toBe(true);
		expect(state.smoothing).toBe(false);
		// Hidden local graphs still auto-fit after worker frames, so projection
		// must already reflect the newest coordinates before resume.
		expect(state.reproject).toHaveBeenCalledTimes(2);
		state.reproject.mockClear();

		renderer.resume();
		expect(renderer.currentPositions).toEqual(latest);
		expect(state.reproject).toHaveBeenCalledOnce();
	});

	test("preserves ordinary smoothing while visible", () => {
		const { renderer, state } = setup();
		const initial = new Float32Array([1, 2, 3]);
		renderer.updatePositions(initial);
		renderer.updatePositions(new Float32Array([7, 8, 9]));

		expect(renderer.currentPositions).toEqual(initial);
		expect(state.smoothing).toBe(true);
		expect(state.reproject).toHaveBeenCalledOnce();
	});

	test("keeps projected coordinates current for auto-fit while hidden", () => {
		const renderer = new GraphRenderer({} as RendererCallbacks);
		renderer.camera.enabled = false;
		renderer.pause();
		renderer.updatePositions(new Float32Array([1, 2, 3]));
		renderer.updatePositions(new Float32Array([7, 8, 9]));

		expect(renderer.projectedPositions).toEqual(new Float32Array([7, 8]));
		renderer.resume();
		expect(renderer.projectedPositions).toEqual(new Float32Array([7, 8]));
	});

	test.each(["destroyed", "contextLost"] as const)("does not restart after %s", (flag) => {
		const { renderer, state, ticker } = setup();
		renderer.pause();
		state[flag] = true;

		renderer.resume();

		expect(ticker.start).not.toHaveBeenCalled();
		expect(state.reproject).not.toHaveBeenCalled();
	});

	test("accepts visibility changes before init or after app cleanup", () => {
		const { renderer, state } = setup();
		state.app = null;

		expect(() => { renderer.pause(); renderer.resume(); }).not.toThrow();
	});
});
