// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { Application, Container, Sprite, Texture, Ticker, UPDATE_PRIORITY } from "pixi.js";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { installObsidianDom } from "../test/obsidianDom";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

interface RenderHarness {
	_ownerWindow: Window;
	app: unknown;
	model: GraphModel | null;
	positions: Float32Array | null;
	positions3: Float32Array | null;
	targetPositions3: Float32Array | null;
	radii: Float32Array | null;
	sprites: Sprite[];
	world: Container;
	positionsDirty: boolean;
	edgesDirty: boolean;
	cullDirty: boolean;
	smoothing: boolean;
	lastCullAt: number;
	contextLost: boolean;
	destroyed: boolean;
	labels: Map<number, {
		alpha: number;
		text: string;
		visible: boolean;
		x: number;
		y: number;
		scale: { x: number };
		destroy(): void;
	}>;
	labelPriority: number[];
	viewport: unknown;
	host: HTMLElement | null;
	colors: unknown;
	lassoPoints: Array<{ x: number; y: number }> | null;
	lassoGraphics: { clear(): void };
	renderFrame(force?: boolean): void;
	cullAndLabel(complete?: boolean): void;
	ensureLabel(id: number, x: number, y: number): void;
	findNodeAt(x: number, y: number): number | null;
	handlePointerMove(event: PointerEvent): void;
	extendLasso(event: PointerEvent): void;
	finishLasso(event: PointerEvent): void;
}

beforeAll(() => installObsidianDom());
let now = 1_000;
const harnessRenderers = new Set<GraphRenderer>();
beforeEach(() => { now = 1_000; vi.spyOn(performance, "now").mockImplementation(() => now); });
afterEach(() => {
	for (const renderer of harnessRenderers) renderer.pause();
	harnessRenderers.clear();
	vi.restoreAllMocks();
	document.body.empty();
});

function setup() {
	const renderer = new GraphRenderer({ onNodeHover: vi.fn() } as unknown as RendererCallbacks);
	harnessRenderers.add(renderer);
	const state = renderer as unknown as RenderHarness;
	state._ownerWindow = window;
	const canvas = document.body.createEl("canvas");
	Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
	const render = vi.fn();
	const blob = new Blob(["png"], { type: "image/png" });
	const extract = vi.fn(() => ({ toBlob: (callback: BlobCallback) => callback(blob) }));
	const app = {
		canvas,
		stage: {},
		screen: { x: 0, y: 0, width: 800, height: 600 },
		render,
		ticker: { stop: vi.fn(), start: vi.fn(), update: vi.fn() },
		renderer: { background: { alpha: 0, color: 0 }, extract: { canvas: extract } },
	};
	state.app = app;
	state.model = buildGraphModel(["note.md"], {}, {});
	state.positions = new Float32Array([10, 20]);
	state.positions3 = new Float32Array([10, 20, 0]);
	state.radii = new Float32Array([5]);
	state.sprites = [new Sprite(Texture.EMPTY)];
	state.colors = { node: 0xffffff, nodeSelected: 0xff0000, edge: 0x999999, label: 0xffffff };
	state.viewport = { scale: 1, referenceScale: 1, toWorld: (x: number, y: number) => ({ x, y }) };
	state.host = document.body.createDiv();
	renderer.camera.enabled = false;
	const cull = vi.spyOn(state, "cullAndLabel").mockImplementation(() => {});
	const settle = () => {
		state.renderFrame();
		render.mockClear();
		cull.mockClear();
	};
	return { renderer, state, app, render, cull, extract, blob, settle };
}

function setupLabels() {
	const result = setup();
	const { state, cull } = result;
	cull.mockRestore();
	state.model = buildGraphModel(Array.from({ length: 6 }, (_, i) => `${i}.md`), {}, {});
	state.positions = new Float32Array([10, 20, 110, 20, 210, 20, 310, 20, 410, 20, 510, 20]);
	state.radii = new Float32Array(6).fill(5);
	state.sprites = Array.from({ length: 6 }, () => new Sprite(Texture.EMPTY));
	state.labelPriority = [0, 1, 2, 3, 4, 5];
	vi.spyOn(state, "ensureLabel").mockImplementation((id, x, y) => {
		state.labels.set(id, {
			alpha: 1,
			text: `${id}`,
			visible: true,
			x,
			y,
			scale: { x: 1 },
			destroy: vi.fn(),
			...{ getBounds: () => ({ x, y, width: 20, height: 12 }) },
		});
	});
	state.cullDirty = true;
	return result;
}

describe("on-demand render scheduling", () => {
	test("removes Pixi's own render listener while retaining the ticker", async () => {
		const ticker = new Ticker();
		const remove = vi.spyOn(ticker, "remove");
		const draw = vi.fn();
		const canvas = document.body.createEl("canvas");
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		vi.spyOn(Application.prototype, "init").mockImplementation(async function (this: Application) {
			Object.assign(this, {
				ticker,
				renderer: { canvas, render: draw, generateTexture: () => Texture.EMPTY },
			});
			// eslint-disable-next-line @typescript-eslint/unbound-method -- Match Pixi's function/context registration.
			ticker.add(this.render, this, UPDATE_PRIORITY.LOW);
		});
		vi.spyOn(Application.prototype, "destroy").mockImplementation(function (this: Application) { this.stage.destroy(); });
		const renderer = new GraphRenderer({ onNodeHover: vi.fn() } as unknown as RendererCallbacks);
		try {
			await renderer.init(document.body.createDiv());
			const app = (renderer as unknown as { app: Application }).app;
			// eslint-disable-next-line @typescript-eslint/unbound-method -- Assert callback identity, not an unbound invocation.
			expect(remove).toHaveBeenCalledWith(app.render, app);
			expect(ticker.count).toBe(1);
			ticker.update(now);
			expect(draw).toHaveBeenCalledOnce();
			now += 16;
			ticker.update(now);
			expect(draw).toHaveBeenCalledOnce();
			renderer.camera.enabled = false;
			canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 10, clientX: 10, clientY: 20, cancelable: true }));
			now += 16;
			ticker.update(now);
			expect(draw).toHaveBeenCalledTimes(2);
			now += 16;
			ticker.update(now);
			expect(draw).toHaveBeenCalledTimes(2);
		} finally {
			renderer.destroy();
			ticker.destroy();
		}
	});

	test("renders once, skips idle ticks and retains the 500 ms safety frame", () => {
		const { state, render } = setup();
		state.renderFrame();
		expect(render).toHaveBeenCalledOnce();
		now += 499;
		state.renderFrame();
		expect(render).toHaveBeenCalledOnce();
		now += 1;
		state.renderFrame();
		expect(render).toHaveBeenCalledTimes(2);
	});

	test("renders an empty scene so background changes do not wait for a model", () => {
		const { renderer, state, render, settle } = setup();
		state.model = null;
		state.positions = null;
		state.radii = null;
		settle();
		renderer.setVisualStyle("flat", 0x123456);
		state.renderFrame();
		expect(render).toHaveBeenCalledOnce();
	});

	test.each(["positionsDirty", "edgesDirty", "cullDirty"] as const)("renders work from %s before that flag is cleared", (flag) => {
		const { state, render, settle } = setup();
		settle();
		state[flag] = true;
		state.renderFrame();
		expect(state[flag]).toBe(false);
		expect(render).toHaveBeenCalledOnce();
	});

	test("renders the last smoothing snap even though smoothing becomes false", () => {
		const { state, render, settle } = setup();
		settle();
		state.positions3 = new Float32Array([10, 20, 0]);
		state.targetPositions3 = new Float32Array([10.01, 20, 0]);
		state.smoothing = true;
		state.renderFrame();
		expect(state.smoothing).toBe(false);
		expect(state.sprites[0].x).toBeCloseTo(10.01);
		expect(render).toHaveBeenCalledOnce();
	});

	test("continues drawing deferred label passes and the final completed pass", () => {
		const { state, render, cull, settle } = setup();
		settle();
		cull.mockImplementationOnce(() => { state.cullDirty = true; });
		state.cullDirty = true;
		state.renderFrame();
		expect(state.cullDirty).toBe(true);
		now += 31;
		state.renderFrame();
		expect(state.cullDirty).toBe(false);
		expect(render).toHaveBeenCalledTimes(2);
	});

	test("renders every real label-budget pass until all six labels are visible", () => {
		const { state, render } = setupLabels();
		state.renderFrame();
		expect(state.labels.size).toBe(4);
		expect(state.cullDirty).toBe(true);
		now += 31;
		state.renderFrame();
		expect(state.labels.size).toBe(6);
		expect(state.cullDirty).toBe(false);
		expect(render).toHaveBeenCalledTimes(2);
		now += 31;
		state.renderFrame();
		expect(render).toHaveBeenCalledTimes(2);
	});

	test.each(["contextLost", "destroyed"] as const)("never renders after %s", (flag) => {
		const { state, render } = setup();
		state[flag] = true;
		state.renderFrame();
		state.renderFrame(true);
		expect(render).not.toHaveBeenCalled();
	});

	test("pauses safety frames and renders immediately after resume", () => {
		const { renderer, state, render, settle } = setup();
		settle();
		renderer.pause();
		now += 1_000;
		state.renderFrame();
		expect(render).not.toHaveBeenCalled();
		renderer.resume();
		state.renderFrame();
		expect(render).toHaveBeenCalledOnce();
	});
});

describe("visual mutation invalidation", () => {
	test.each([
		["selection", (renderer: GraphRenderer) => renderer.setSelected(0)],
		["dim mask", (renderer: GraphRenderer) => renderer.setDimMask(new Uint8Array([0]))],
		["highlight mask", (renderer: GraphRenderer) => renderer.setHighlightMask(new Uint8Array([1]))],
		["alpha factors", (renderer: GraphRenderer) => renderer.setAlphaFactors(new Float32Array([0.5]))],
		["edge style", (renderer: GraphRenderer) => renderer.setEdgeStyle(false, 2, 0.5)],
		["unchanged texture with changed backdrop", (renderer: GraphRenderer) => renderer.setVisualStyle("flat", 0x123456)],
		["cluster hulls", (renderer: GraphRenderer) => renderer.drawClusterHulls(null)],
		["trail", (renderer: GraphRenderer) => renderer.setSessionTrail([0])],
		["pins", (renderer: GraphRenderer) => renderer.setPinned(new Set([0]))],
	] as const)("renders %s on the next tick", (_name, change) => {
		const { renderer, state, render, settle } = setup();
		settle();
		change(renderer);
		state.renderFrame();
		expect(render).toHaveBeenCalledOnce();
	});

	test("changes hover tint and labels without waiting for the safety frame", () => {
		const { state, render, cull, settle } = setup();
		settle();
		vi.spyOn(state, "findNodeAt").mockReturnValue(0);
		state.handlePointerMove({ clientX: 10, clientY: 20 } as PointerEvent);
		state.renderFrame();
		expect(state.sprites[0].tint).toBe(0xff0000);
		expect(cull).toHaveBeenCalledOnce();
		expect(render).toHaveBeenCalledOnce();
	});

	test("renders lasso movement and the clearing of an unfinished polygon", () => {
		const { state, render, settle } = setup();
		settle();
		state.lassoPoints = [{ x: 0, y: 0 }];
		state.extendLasso({ clientX: 10, clientY: 20 } as PointerEvent);
		state.renderFrame();
		expect(render).toHaveBeenCalledOnce();
		state.finishLasso({} as PointerEvent);
		state.renderFrame();
		expect(render).toHaveBeenCalledTimes(2);
	});

	test("redraws a changed Explore overlay but skips equal content on later animation frames", () => {
		const { renderer, state, render, cull, settle } = setup();
		settle();
		renderer.setExploreOverlay({ centerId: 0, neighbors: [], candidateId: null });
		state.renderFrame();
		expect(render).toHaveBeenCalledOnce();
		expect(cull).toHaveBeenCalledOnce();
		renderer.setExploreOverlay({ centerId: 0, neighbors: [], candidateId: null });
		state.renderFrame();
		expect(render).toHaveBeenCalledOnce();
		renderer.setExploreOverlay(null);
		now += 31;
		state.renderFrame();
		expect(render).toHaveBeenCalledTimes(2);
		expect(cull).toHaveBeenCalledTimes(2);
	});

	test("rebuilds labels after theme colors change", () => {
		const { renderer, state, cull, render, settle } = setup();
		settle();
		renderer.refreshThemeColors();
		state.renderFrame();
		expect(cull).toHaveBeenCalledOnce();
		expect(render).toHaveBeenCalledOnce();
	});
});

describe("forced PNG render", () => {
	test("finishes all deferred labels in the single forced export frame", async () => {
		const { renderer, state, render, blob } = setupLabels();
		await expect(renderer.exportPng()).resolves.toBe(blob);
		expect(state.labels.size).toBe(6);
		expect(state.cullDirty).toBe(false);
		expect(render).toHaveBeenCalledOnce();
	});
	test("flushes sprite and label work before rendering and extracting even while paused", async () => {
		const { renderer, state, cull, render, extract, blob, settle } = setup();
		settle();
		renderer.pause();
		state.positions = new Float32Array([30, 40]);
		state.positionsDirty = true;
		state.cullDirty = true;
		state.lastCullAt = now;
		extract.mockImplementation(() => {
			expect(state.sprites[0].position.x).toBe(30);
			expect(state.sprites[0].position.y).toBe(40);
			expect(cull).toHaveBeenCalledWith(true);
			expect(render).toHaveBeenCalledOnce();
			return { toBlob: (callback: BlobCallback) => callback(blob) };
		});

		await expect(renderer.exportPng()).resolves.toBe(blob);
		expect(extract).toHaveBeenCalledOnce();
	});

	test.each(["contextLost", "destroyed"] as const)("does not attempt extraction after %s", async (flag) => {
		const { renderer, state, extract, render } = setup();
		state[flag] = true;
		await expect(renderer.exportPng()).resolves.toBeNull();
		expect(render).not.toHaveBeenCalled();
		expect(extract).not.toHaveBeenCalled();
	});
});
