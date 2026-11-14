// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { GraphInsightView } from "./GraphView";
import { buildGraphModel } from "../data/GraphStore";

vi.mock("obsidian", async (original) => ({
	...await original<typeof import("obsidian")>(),
	ItemView: class {},
	debounce: (callback: () => void) => callback,
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

function build() {
	let finish!: () => void;
	const ready = new Promise<void>((resolve) => { finish = resolve; });
	const plugin = {
		snapshotsLoaded: false,
		ensureSnapshots: vi.fn(() => ready),
		snapshotStore: { version: 1, snapshots: [{ version: 1, capturedAt: 0, paths: ["a.md"], edges: [], pagerank: [] }] },
	};
	const view = new GraphInsightView({} as WorkspaceLeaf, plugin as never);
	const compute = vi.fn(async () => ({ addedLinks: [], removedLinks: [], growingHubs: [] }));
	const setData = vi.fn();
	Object.assign(view, {
		model: buildGraphModel(["a.md"], {}, {}), facts: [{ ctime: 0, mtime: 0 }],
		changesPanel: { setData }, changesClient: { stop: vi.fn(), compute }, applyChangesMask: vi.fn(),
	});
	const internal = view as unknown as { refreshChanges(): Promise<void>; changesGeneration: number; closing: boolean };
	return { internal, plugin, compute, setData, finish };
}

describe("Changes waits for lazy snapshots", () => {
	test("does not read history or compute until loading finishes", async () => {
		const { internal, plugin, compute, finish } = build();
		const pending = internal.refreshChanges();
		expect(plugin.ensureSnapshots).toHaveBeenCalledOnce();
		expect(compute).not.toHaveBeenCalled();
		finish();
		await pending;
		expect(compute).toHaveBeenCalledOnce();
	});
	test("a close during loading prevents stale work", async () => {
		const { internal, compute, setData, finish } = build();
		const pending = internal.refreshChanges();
		internal.closing = true;
		internal.changesGeneration++;
		finish();
		await pending;
		expect(compute).not.toHaveBeenCalled();
		expect(setData).toHaveBeenCalledExactlyOnceWith(null);
	});
});
