// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf, TFile } from "obsidian";
import { GraphInsightView } from "./GraphView";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { DEFAULT_SETTINGS } from "../settings/schema";
import type { NodeFacts } from "../encoding/metrics";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		constructor(leaf: { app: unknown }) { this.app = leaf.app; }
	},
	getAllTags: (cache: { tags: string[] }) => cache.tags,
	debounce: (callback: () => void, delay: number) => {
		let timer: number | undefined;
		return () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(callback, delay);
		};
	},
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

interface Internals {
	model: GraphModel | null;
	renamed: Map<string, string>;
	explicitPins: Set<number>;
	facts: NodeFacts[];
	rebuilding: boolean;
	rebuildPending: boolean;
	closing: boolean;
	renderer: object;
	layout: object;
	rebuildGraph(): Promise<void>;
	onClose(): Promise<void>;
	buildSeedPositions: () => Promise<{ seed: Float32Array | undefined; pinnedPaths: string[] }>;
	savePositions(): Promise<void>;
}

function build() {
	const files = [{ path: "a.md", stat: { ctime: 1, mtime: 2, size: 3 }, parent: { path: "" } }] as TFile[];
	const fileCache = { tags: ["#old"] };
	const app = {
		vault: { getMarkdownFiles: () => files },
		metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => fileCache },
	};
	const plugin = {
		settings: DEFAULT_SETTINGS,
		usageLog: {},
		dataStore: { loadPositions: vi.fn(async () => null), savePositions: vi.fn(async () => {}) },
	};
	const view = new GraphInsightView({ app } as unknown as WorkspaceLeaf, plugin as never) as unknown as Internals;
	const renderer = { currentPositions: null as Float32Array | null, setModel: vi.fn(), setPinned: vi.fn(), setLabelOptions: vi.fn(), setEdgeStyle: vi.fn(), destroy: vi.fn() };
	const layout = { start: vi.fn(), stop: vi.fn(), pin: vi.fn() };
	const effects = {
		apply3D: vi.fn(), applyPhysics: vi.fn(), applyLayoutRule: vi.fn(), applyEncoding: vi.fn(),
		applyOverlays: vi.fn(), refreshTimelineData: vi.fn(), syncTimelineAndTrail: vi.fn(),
		updateEmptyState: vi.fn(), recomputeVisual: vi.fn(),
	};
	Object.assign(view, { renderer, layout, ...effects });
	return { view, files, fileCache, plugin, renderer, layout, effects };
}

afterEach(() => vi.useRealTimers());

describe("queued graph rebuild", () => {
	test("rebuilds once more with the latest vault after changes during a position load", async () => {
		vi.useFakeTimers();
		const { view, files, renderer, layout } = build();
		let release!: () => void;
		view.buildSeedPositions = () => new Promise((resolve) => {
			release = () => resolve({ seed: undefined, pinnedPaths: [] });
		});
		const first = view.rebuildGraph();
		files.push({ ...files[0], path: "b.md" });
		await view.rebuildGraph();
		await view.rebuildGraph();
		release();
		await first;
		view.buildSeedPositions = async () => ({ seed: undefined, pinnedPaths: [] });
		await vi.advanceTimersByTimeAsync(2000);
		expect(view.model?.nodes.map((node) => node.path)).toEqual(["a.md", "b.md"]);
		expect(renderer.setModel).toHaveBeenCalledTimes(2);
		expect(layout.start).toHaveBeenCalledTimes(2);
		expect(view.rebuilding).toBe(false);
	});
	test("closing discards a queued rebuild and its late position load", async () => {
		vi.useFakeTimers();
		const { view, renderer } = build();
		let release!: () => void;
		view.buildSeedPositions = () => new Promise((resolve) => {
			release = () => resolve({ seed: undefined, pinnedPaths: [] });
		});
		const first = view.rebuildGraph();
		await view.rebuildGraph();
		await view.onClose();
		release();
		await first;
		await vi.advanceTimersByTimeAsync(2000);
		expect(renderer.setModel).not.toHaveBeenCalled();
		expect(view.model).toBeNull();
		expect(view.rebuildPending).toBe(false);
	});
});

describe("facts refresh with unchanged topology", () => {
	test("updates metadata and usage while keeping worker metrics and layout", async () => {
		const { view, files, fileCache, plugin, layout, effects } = build();
		await view.rebuildGraph();
		view.facts[0].pagerank = 0.7;
		view.facts[0].cluster = "Work";
		const model = view.model;
		vi.clearAllMocks();
		files[0].stat.mtime = 20;
		files[0].stat.size = 40;
		fileCache.tags = ["#new"];
		plugin.usageLog = { "a.md": { total: 3, days: {} } };
		await view.rebuildGraph();
		expect(view.facts[0]).toMatchObject({ mtime: 20, size: 40, tags: ["new"], opensTotal: 3, pagerank: 0.7, cluster: "Work" });
		expect(view.model).toBe(model);
		expect(layout.start).not.toHaveBeenCalled();
		expect(effects.applyEncoding).toHaveBeenCalledOnce();
		expect(effects.recomputeVisual).toHaveBeenCalledOnce();
		expect(effects.refreshTimelineData).toHaveBeenCalledOnce();
		expect(effects.applyLayoutRule).toHaveBeenCalledOnce();
	});
	test("an mtime change refreshes visuals but does not regroup nodes", async () => {
		const { view, files, effects } = build();
		await view.rebuildGraph();
		vi.clearAllMocks();
		files[0].stat.mtime = 30;
		await view.rebuildGraph();
		expect(view.facts[0].mtime).toBe(30);
		expect(effects.applyEncoding).toHaveBeenCalledOnce();
		expect(effects.applyLayoutRule).not.toHaveBeenCalled();
	});
	test("unchanged facts leave visuals and layout untouched", async () => {
		const { view, effects, layout } = build();
		await view.rebuildGraph();
		const facts = view.facts;
		vi.clearAllMocks();
		await view.rebuildGraph();
		expect(view.facts).toBe(facts);
		expect(effects.applyEncoding).not.toHaveBeenCalled();
		expect(layout.start).not.toHaveBeenCalled();
	});
});


describe("renamed note positions", () => {
	test("keeps live coordinates and an explicit pin after renaming", async () => {
		const { view, files, renderer, layout } = build();
		await view.rebuildGraph();
		renderer.currentPositions = new Float32Array([41, 52, 63]);
		view.explicitPins.add(0);
		files[0].path = "renamed.md";
		view.renamed = new Map([["renamed.md", "a.md"]]);
		await view.rebuildGraph();
		expect(layout.start).toHaveBeenLastCalledWith(expect.anything(), new Float32Array([41, 52, 63]), 3);
		expect(layout.pin).toHaveBeenLastCalledWith(0, 41, 52, 63);
		expect(view.explicitPins.has(0)).toBe(true);
		expect(view.renamed.size).toBe(0);
	});
	test("loads saved positions and pins under the previous path", async () => {
		const { view, files, plugin, layout } = build();
		files[0].path = "renamed.md";
		view.renamed = new Map([["renamed.md", "a.md"]]);
		Object.assign(plugin.dataStore, { loadPositions: async () => ({ positions: { "a.md": [11, 22] }, pins: ["a.md"] }) });
		await view.rebuildGraph();
		expect(layout.start).toHaveBeenLastCalledWith(expect.anything(), new Float32Array([11, 22, 0]), 3);
		expect(layout.pin).toHaveBeenLastCalledWith(0, 11, 22, 0);
	});
	test("retains a rename arriving during an earlier rebuild for the next model", async () => {
		const { view, files, renderer } = build();
		view.model = buildGraphModel(["a.md"], {}, {});
		view.renamed = new Map([["b.md", "a.md"]]);
		files[0].path = "b.md";
		let release!: () => void;
		view.buildSeedPositions = () => new Promise((resolve) => {
			release = () => resolve({ seed: new Float32Array([10, 20, 30]), pinnedPaths: [] });
		});
		const first = view.rebuildGraph();
		view.renamed = new Map([["c.md", "a.md"]]);
		release();
		await first;
		renderer.currentPositions = new Float32Array([10, 20, 30]);
		expect([...view.renamed]).toEqual([["c.md", "b.md"]]);
	});
});

describe("position writes before layout produces coordinates", () => {
	test("does not replace saved coordinates with the initial zero buffer", async () => {
		const { view, renderer, plugin } = build();
		await view.rebuildGraph();
		renderer.currentPositions = new Float32Array(3);
		await view.savePositions();
		expect(plugin.dataStore.savePositions).not.toHaveBeenCalled();
		await view.onClose();
		expect(plugin.dataStore.savePositions).not.toHaveBeenCalled();
	});
	test("flushes a received frame, including a valid zero coordinate, and resets on rebuild", async () => {
		const { view, files, renderer, plugin } = build();
		Object.assign(renderer, { updatePositions: (positions: Float32Array) => { renderer.currentPositions = new Float32Array(positions); } });
		const internal = view as unknown as { receiveLayoutPositions(positions: Float32Array): void; flushPositions(): Promise<void> };
		await view.rebuildGraph();
		internal.receiveLayoutPositions(new Float32Array([0, 20.12, 30.23]));
		await internal.flushPositions();
		expect(plugin.dataStore.savePositions).toHaveBeenCalledWith({ positions: { "a.md": [0, 20.1, 30.2] }, pins: [] });
		files.push({ ...files[0], path: "b.md" });
		await view.rebuildGraph();
		await internal.flushPositions();
		expect(plugin.dataStore.savePositions).toHaveBeenCalledOnce();
	});
});
