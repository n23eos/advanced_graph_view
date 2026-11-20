import { describe, expect, test, vi } from "vitest";
import type { GraphModel } from "../data/GraphStore";
import type { EdgePathView } from "./EdgeMesh";
import { EDGE_PULSE_LIMIT } from "./edgePulse";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

interface PulseHarness {
	_ownerWindow: Window;
	frameNow: () => number;
	modernAppearance: boolean;
	overviewStyle: boolean;
	edgesVisible: boolean;
	paused: boolean;
	hiddenMask: Uint8Array | null;
	incidentEdges: number[][];
	model: GraphModel;
	colors: { nodeSelected: number };
	viewport: { scale: number };
	edgeMesh: { getEdgePath(index: number, out: EdgePathView): boolean };
	edgePulseBatch: { origin: number; edgeIndices: number[] } | null;
	needsRender: boolean;
	startEdgePulses(origin: number | null): void;
	advanceEdgePulses(): void;
}

function ownerWindow(reduced = false): Window {
	return {
		matchMedia: vi.fn(() => ({ matches: reduced })),
	} as unknown as Window;
}

function setup(edgeCount = 1) {
	let now = 1_000;
	const renderer = new GraphRenderer({} as RendererCallbacks);
	const harness = renderer as unknown as PulseHarness;
	const edges = Array.from({ length: edgeCount }, () => ({ source: 0, target: 1 }));
	const getEdgePath = vi.fn((_index: number, out: EdgePathView) => {
		out.points = new Float32Array([0, 0, 20, 10, 40, 0]);
		out.offset = 0;
		out.pointCount = 3;
		out.reversed = false;
		return true;
	});
	harness._ownerWindow = ownerWindow();
	harness.frameNow = () => now;
	harness.modernAppearance = false;
	harness.overviewStyle = false;
	harness.edgesVisible = true;
	harness.paused = false;
	harness.hiddenMask = null;
	harness.incidentEdges = [[...edges.keys()], [...edges.keys()]];
	harness.model = { edges } as unknown as GraphModel;
	harness.colors = { nodeSelected: 0x7c3aed };
	harness.viewport = { scale: 2 };
	harness.edgeMesh = { getEdgePath };
	return { renderer, harness, getEdgePath, setNow: (value: number) => { now = value; } };
}

describe("GraphRenderer edge pulses", () => {
	test("runs in a classic legacy appearance without overview and bounds hubs", () => {
		const { harness, getEdgePath } = setup(601);

		harness.startEdgePulses(0);

		expect(harness.edgePulseBatch?.origin).toBe(0);
		expect(harness.edgePulseBatch?.edgeIndices).toHaveLength(EDGE_PULSE_LIMIT);
		expect(getEdgePath).toHaveBeenCalled();
	});

	test("does not start motion when the operating system requests less motion", () => {
		const { harness, getEdgePath } = setup();
		harness._ownerWindow = ownerWindow(true);

		harness.startEdgePulses(0);

		expect(harness.edgePulseBatch).toBeNull();
		expect(getEdgePath).not.toHaveBeenCalled();
	});

	test.each(["hidden node", "hidden edges"] as const)("does not start for %s", (reason) => {
		const { harness, getEdgePath } = setup();
		if (reason === "hidden node") harness.hiddenMask = new Uint8Array([1, 0]);
		else harness.edgesVisible = false;

		harness.startEdgePulses(0);

		expect(harness.edgePulseBatch).toBeNull();
		expect(getEdgePath).not.toHaveBeenCalled();
	});

	test("skips links whose other endpoint is hidden by EdgeMesh", () => {
		const { harness, getEdgePath } = setup();
		getEdgePath.mockReturnValue(false);

		harness.startEdgePulses(0);

		expect(harness.edgePulseBatch).toBeNull();
	});

	test("invalidates through the final frame and becomes idle after cleanup", () => {
		const { harness, setNow } = setup();
		harness.startEdgePulses(0);
		harness.needsRender = false;
		setNow(2_000);

		harness.advanceEdgePulses();

		expect(harness.edgePulseBatch).toBeNull();
		expect(harness.needsRender).toBe(true);
		harness.needsRender = false;
		harness.advanceEdgePulses();
		expect(harness.needsRender).toBe(false);
	});

	test("cleans up an active burst when the renderer pauses", () => {
		const { renderer, harness } = setup();
		harness.startEdgePulses(0);

		renderer.pause();

		expect(harness.edgePulseBatch).toBeNull();
	});
});
