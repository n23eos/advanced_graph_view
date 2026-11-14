// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { TFile, WorkspaceLeaf } from "obsidian";
import type { NodeFacts } from "../encoding/metrics";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { GraphInsightView } from "./GraphView";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		constructor(leaf: { app: unknown }) { this.app = leaf.app; }
	},
	getAllTags: () => [],
	debounce: (callback: () => void) => callback,
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

interface Internals {
	facts: NodeFacts[];
	panel: { setPropertyKeys: ReturnType<typeof vi.fn>; setOverlayCounts: ReturnType<typeof vi.fn> };
	renderer: object;
	layout: object;
	rebuildGraph(): Promise<void>;
}

function build() {
	const [file] = [{ path: "a.md", stat: { ctime: 1, mtime: 2, size: 3 }, parent: { path: "" } }] as TFile[];
	const fileCache: { frontmatter: Record<string, unknown> } = { frontmatter: { Status: "Active" } };
	const app = {
		vault: { getMarkdownFiles: () => [file] },
		metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => fileCache },
	};
	const plugin = {
		settings: DEFAULT_SETTINGS,
		usageLog: {},
		dataStore: { loadPositions: vi.fn(async () => null) },
		flushSettings: vi.fn(async () => {}),
	};
	const view = new GraphInsightView({ app } as unknown as WorkspaceLeaf, plugin as never) as unknown as Internals;
	const panel = { setPropertyKeys: vi.fn(), setOverlayCounts: vi.fn() };
	const renderer = { setModel: vi.fn(), setLabelOptions: vi.fn(), setEdgeStyle: vi.fn() };
	const layout = { start: vi.fn(), pin: vi.fn() };
	const effects = {
		apply3D: vi.fn(), applyPhysics: vi.fn(), applyLayoutRule: vi.fn(), applyEncoding: vi.fn(),
		applyOverlays: vi.fn(), refreshTimelineData: vi.fn(), syncTimelineAndTrail: vi.fn(),
		updateEmptyState: vi.fn(), recomputeVisual: vi.fn(),
	};
	Object.assign(view, { panel, renderer, layout, ...effects });
	return { view, fileCache, panel, effects };
}

describe("GraphView frontmatter properties", () => {
	test("builds properties, updates panel keys, and refreshes values without regrouping", async () => {
		const { view, fileCache, panel, effects } = build();
		await view.rebuildGraph();
		expect(view.facts[0].properties).toEqual({ status: ["Active"] });
		expect(panel.setPropertyKeys).toHaveBeenLastCalledWith(["status"]);

		vi.clearAllMocks();
		fileCache.frontmatter = { Status: "Done", Team: ["Core", "Docs"] };
		await view.rebuildGraph();
		expect(view.facts[0].properties).toEqual({ status: ["Done"], team: ["Core", "Docs"] });
		expect(panel.setPropertyKeys).toHaveBeenLastCalledWith(["status", "team"]);
		expect(effects.applyEncoding).toHaveBeenCalledOnce();
		expect(effects.applyLayoutRule).not.toHaveBeenCalled();
	});
});
