// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { GraphInsightView } from "./GraphView";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import type { TopologyDiff } from "../analysis/graphChanges";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		constructor(leaf: { app: unknown }) { this.app = leaf.app; }
	},
	debounce: (callback: () => void) => callback,
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

interface Internals {
	model: GraphModel | null;
	renderer: { setModel: ReturnType<typeof vi.fn> };
	layout: object;
	facts: { ctime: number; mtime: number }[];
	changesPanel: { setData: ReturnType<typeof vi.fn> };
	changesClient: { stop: ReturnType<typeof vi.fn>; compute: ReturnType<typeof vi.fn> };
	changesSelection: { periodDays: number; category: null };
	changesGeneration: number;
	changesData: { addedLinks: TopologyDiff["addedLinks"] };
	rebuilding: boolean;
	buildSeedPositions: ReturnType<typeof vi.fn>;
	applyChangesMask: ReturnType<typeof vi.fn>;
	rebuildGraph(): Promise<void>;
	refreshChanges(): Promise<void>;
	onClose(): Promise<void>;
	savePositions: ReturnType<typeof vi.fn>;
}

function build() {
	const app = {
		vault: { getMarkdownFiles: () => [{ path: "a.md" }] },
		metadataCache: { resolvedLinks: {}, unresolvedLinks: {} },
	};
	const plugin = { snapshotStore: { version: 1, snapshots: [{
		version: 1, capturedAt: 0, paths: ["a.md"], edges: [], pagerank: [],
	}] } };
	const view = new GraphInsightView({ app } as unknown as WorkspaceLeaf, plugin as never) as unknown as Internals;
	view.applyChangesMask = vi.fn();
	return view;
}

describe("release reliability", () => {
	test("a failed position load releases the rebuild gate so a later attempt can run", async () => {
		const view = build();
		view.renderer = { setModel: vi.fn() };
		view.layout = {};
		view.buildSeedPositions = vi.fn().mockRejectedValue(new Error("read failed"));
		await expect(view.rebuildGraph()).rejects.toThrow("read failed");
		expect(view.rebuilding).toBe(false);
		await expect(view.rebuildGraph()).rejects.toThrow("read failed");
		expect(view.buildSeedPositions).toHaveBeenCalledTimes(2);
	});

	test("closing during position loading prevents a late result touching a destroyed graph", async () => {
		const view = build();
		let resolve!: (value: { seed: Float32Array; pinnedPaths: string[] }) => void;
		view.buildSeedPositions = vi.fn(() => new Promise((done) => { resolve = done; }));
		const setModel = vi.fn();
		view.renderer = { setModel, destroy: vi.fn() } as typeof view.renderer;
		view.layout = { stop: vi.fn() };
		view.savePositions = vi.fn().mockResolvedValue(undefined);
		const pending = view.rebuildGraph();
		await view.onClose();
		resolve({ seed: new Float32Array(3), pinnedPaths: [] });
		await pending;
		expect(setModel).not.toHaveBeenCalled();
		expect(view.rebuilding).toBe(false);
	});

	test("a slow diff from the previous period cannot replace the latest selection", async () => {
		const view = build();
		view.model = buildGraphModel(["a.md"], {}, {});
		view.facts = [{ ctime: 0, mtime: 0 }];
		view.changesPanel = { setData: vi.fn() };
		let resolveOld!: (diff: TopologyDiff) => void;
		const latest = { addedLinks: [{ fromPath: "new.md", toPath: "a.md" }], removedLinks: [], growingHubs: [] };
		view.changesClient = {
			stop: vi.fn(),
			compute: vi.fn()
				.mockImplementationOnce(() => new Promise<TopologyDiff>((resolve) => { resolveOld = resolve; }))
				.mockResolvedValueOnce(latest),
		};
		const oldRequest = view.refreshChanges();
		view.changesSelection = { periodDays: 30, category: null };
		await view.refreshChanges();
		resolveOld({ addedLinks: [], removedLinks: [], growingHubs: [] });
		await oldRequest;
		expect(view.changesClient.stop).toHaveBeenCalledTimes(2);
		expect(view.changesData.addedLinks).toEqual(latest.addedLinks);
		expect(view.changesPanel.setData).toHaveBeenLastCalledWith(expect.objectContaining({ addedLinks: latest.addedLinks }));
		expect(view.applyChangesMask).toHaveBeenCalledTimes(1);
	});
});
