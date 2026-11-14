// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf, TFile } from "obsidian";
import { GraphInsightView } from "./GraphView";
import type { GraphModel } from "../data/GraphStore";
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
