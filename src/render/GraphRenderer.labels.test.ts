// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { installObsidianDom } from "../test/obsidianDom";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

interface FakeLabel {
	text: string;
	alpha: number;
	visible: boolean;
	width: number;
	height: number;
	x: number;
	y: number;
	scaleValue: number;
	position: { set(x: number, y: number): void };
	scale: { x: number; set(value: number): void };
	destroy(): void;
}

interface LabelHarness {
	_ownerWindow: Window;
	host: HTMLElement;
	model: GraphModel;
	positions: Float32Array;
	depthScales: Float32Array;
	projectedCoreRadii: Float32Array;
	viewport: { scale: number; referenceScale: number };
	colors: { label: number };
	world: { position: { x: number; y: number; set(x: number, y: number): void } };
	modernAppearance: boolean;
	modernLabelOrder: number[];
	labels: Map<number, FakeLabel>;
	labelFades: Map<number | string, { label: FakeLabel; target: number; placement: number }>;
	labelOverlay: { sync: ReturnType<typeof vi.fn> };
	labelsVisible: boolean;
	labelMaxCount: number;
	labelZoomThreshold: number;
	labelHubCount: number;
	labelScaleWithZoom: boolean;
	folderLabelsEnabled: boolean;
	overviewStyle: boolean;
	fittedCameraDistance: number;
	ensureLabel(id: number, x: number, y: number): void;
	cullModernLabels(isOnScreen: (id: number) => boolean, complete: boolean): void;
	advanceLabelFades(force: boolean): void;
	syncLabelOverlay(): void;
}

beforeAll(() => installObsidianDom());
beforeEach(() => vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null));
afterEach(() => vi.restoreAllMocks());

function fakeLabel(): FakeLabel {
	const label: FakeLabel = {
		text: "note",
		alpha: 0,
		visible: false,
		width: 24,
		height: 12,
		x: 0,
		y: 0,
		scaleValue: 1,
		position: { set: (x, y) => { label.x = x; label.y = y; } },
		scale: { x: 1, set: (value) => { label.scaleValue = value; label.scale.x = value; } },
		destroy: vi.fn(),
	};
	return label;
}

function setup(depths: readonly number[]) {
	const renderer = new GraphRenderer({} as RendererCallbacks);
	const state = renderer as unknown as LabelHarness;
	state.model = buildGraphModel(depths.map((_, id) => `${id}.md`), {}, {});
	state.positions = new Float32Array(depths.flatMap((_, id) => [id * 80, 0]));
	state.depthScales = new Float32Array(depths);
	state.projectedCoreRadii = new Float32Array(depths.length).fill(4);
	state.viewport = { scale: 1, referenceScale: 1 };
	state.colors = { label: 0xffffff };
	state._ownerWindow = window;
	state.host = document.body;
	state.labelOverlay = { sync: vi.fn() };
	state.modernAppearance = true;
	state.modernLabelOrder = depths.map((_, id) => id);
	state.labelsVisible = true;
	state.labelMaxCount = depths.length;
	state.labelHubCount = 0;
	state.labelScaleWithZoom = false;
	state.folderLabelsEnabled = false;
	state.overviewStyle = false;
	state.fittedCameraDistance = 3531.93;
	renderer.camera.enabled = true;
	renderer.camera.px = 8.49;
	renderer.camera.py = 0;
	renderer.camera.pz = 0;
	renderer.camera.tx = 0;
	renderer.camera.ty = 0;
	renderer.camera.tz = 0;
	state.ensureLabel = (id) => {
		if (!state.labels.has(id)) state.labels.set(id, fakeLabel());
	};
	return { renderer, state };
}

function activeIds(state: LabelHarness): number[] {
	return [...state.labelFades]
		.filter((entry): entry is [number, { label: FakeLabel; target: number; placement: number }] =>
			typeof entry[0] === "number" && entry[1].target > 0)
		.map(([id]) => id);
}

describe("GraphRenderer modern 3D labels", () => {
	test("uses projected node depth for the zoom threshold in a flown-through camera", () => {
		const { state } = setup([0.55, 0.75]);
		state.labelZoomThreshold = 0.6;

		state.cullModernLabels(() => true, true);

		expect(activeIds(state)).toEqual([1]);
	});

	test("honors zoom thresholds below the old implicit 1.15 floor", () => {
		const { state } = setup([0.55, 0.75]);
		state.labelZoomThreshold = 0.5;

		state.cullModernLabels(() => true, true);

		expect(activeIds(state)).toEqual([0, 1]);
	});

	test("scales hub text from projected depth instead of the orbit-pivot distance", () => {
		const { state } = setup([0.55]);
		state.labelHubCount = 1;
		state.labelScaleWithZoom = true;

		state.cullModernLabels(() => true, true);

		expect(state.labels.get(0)?.scaleValue).toBe(0.8);
	});

	test("lets the configured maximum exceed the old overview cap", () => {
		const { state } = setup(Array.from({ length: 20 }, () => 1));
		state.labelZoomThreshold = 0.5;
		state.labelMaxCount = 20;
		state.labelHubCount = 20;
		state.overviewStyle = true;

		state.cullModernLabels(() => true, true);

		expect(activeIds(state)).toHaveLength(20);
	});

	test("mirrors 2D pan and zoom into the sharp label layer", () => {
		const { renderer, state } = setup([1]);
		renderer.camera.enabled = false;
		state.viewport.scale = 2;
		state.world.position.set(10, 20);
		state.cullModernLabels(() => true, true);
		state.advanceLabelFades(true);

		state.syncLabelOverlay();

		expect(state.labelOverlay.sync).toHaveBeenCalledWith([
			expect.objectContaining({ id: 0, x: 10, y: 34, scale: 1 }),
		], expect.objectContaining({ fontSize: 11, fill: "#ffffff" }));
	});
});
