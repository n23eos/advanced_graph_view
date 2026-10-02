// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { GraphInsightView } from "./GraphView";
import { parseQuery, type ParsedQuery } from "../query/QueryParser";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";

vi.mock("obsidian", async (importOriginal) => {
	const original = await importOriginal<typeof import("obsidian")>();
	return {
		...original,
		ItemView: class {
			app: unknown;
			constructor(leaf: { app: unknown }) { this.app = leaf.app; }
		},
		debounce: (callback: () => void, delay: number) => {
			let timer: number | undefined;
			return () => {
				window.clearTimeout(timer);
				timer = window.setTimeout(callback, delay);
			};
		},
	};
});
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

interface ViewInternals {
	hardQuery: ParsedQuery | null;
	contentIndex: Map<string, Set<string>>;
	contentIndexJobs: number;
	model: GraphModel | null;
	renderer: object | null;
	layout: object | null;
	recomputeVisual: () => void;
	pushSearchUi: () => void;
	ensureContentIndex(needles: string[]): Promise<void>;
	handleMetadataResolved(): void;
	rebuildGraph(): Promise<void>;
	refreshVault(): Promise<void>;
	savePositions: () => Promise<void>;
	onClose(): Promise<void>;
}

function makeView(bodies: Record<string, string>, read?: (file: { path: string }) => Promise<string>) {
	const files = Object.keys(bodies).map((path) => ({ path }));
	const cachedRead = vi.fn(read ?? (async (file: { path: string }) => bodies[file.path]));
	const app = {
		vault: { getMarkdownFiles: () => files, cachedRead },
		metadataCache: { resolvedLinks: {}, unresolvedLinks: {} },
	};
	const leaf = { app } as unknown as WorkspaceLeaf;
	const view = new GraphInsightView(leaf, {} as ConstructorParameters<typeof GraphInsightView>[1]);
	const internal = view as unknown as ViewInternals;
	internal.hardQuery = parseQuery("content:foo");
	internal.recomputeVisual = vi.fn();
	internal.pushSearchUi = vi.fn();
	// The real rebuild can skip unchanged topology; content refresh must not.
	internal.model = buildGraphModel(Object.keys(bodies), {}, {});
	internal.renderer = {};
	internal.layout = {};
	return { view: internal, cachedRead };
}

describe("content filter after vault changes", () => {
	afterEach(() => vi.useRealTimers());

	test("metadata resolve rescans the committed query even when topology is unchanged", async () => {
		vi.useFakeTimers();
		const bodies = { "a.md": "foo", "b.md": "bar" };
		const { view } = makeView(bodies);
		await view.ensureContentIndex(["foo"]);
		expect([...view.contentIndex.get("foo")!]).toEqual(["a.md"]);

		bodies["a.md"] = "bar";
		bodies["b.md"] = "foo";
		view.handleMetadataResolved();
		await vi.advanceTimersByTimeAsync(2000);
		expect([...view.contentIndex.get("foo")!]).toEqual(["b.md"]);
		expect(view.contentIndexJobs).toBe(0);
		expect(view.recomputeVisual).toHaveBeenCalledTimes(2);
	});

	test("bursts of metadata events perform one new scan", async () => {
		vi.useFakeTimers();
		const { view, cachedRead } = makeView({ "a.md": "foo" });
		await view.ensureContentIndex(["foo"]);
		for (let i = 0; i < 5; i++) view.handleMetadataResolved();
		await vi.advanceTimersByTimeAsync(2000);
		expect(cachedRead).toHaveBeenCalledTimes(2);
	});

	test("an invalidated in-flight scan cannot publish its old matches", async () => {
		vi.useFakeTimers();
		let finishOldRead: (text: string) => void = () => {};
		let reads = 0;
		const { view } = makeView({ "a.md": "bar" }, async () => {
			if (++reads === 1) return new Promise<string>((resolve) => { finishOldRead = resolve; });
			return "bar";
		});
		const oldScan = view.ensureContentIndex(["foo"]);
		view.handleMetadataResolved();
		await vi.advanceTimersByTimeAsync(2000);
		finishOldRead("foo");
		await oldScan;
		expect([...view.contentIndex.get("foo")!]).toEqual([]);
		expect(view.contentIndexJobs).toBe(0);
		// The cancelled scan also updates the indexing indicator when it exits.
		expect(view.recomputeVisual).toHaveBeenCalledTimes(2);
	});

	test("clearing the committed query before refresh avoids an unnecessary scan", async () => {
		vi.useFakeTimers();
		const { view, cachedRead } = makeView({ "a.md": "foo" });
		view.handleMetadataResolved();
		view.hardQuery = null;
		await vi.advanceTimersByTimeAsync(2000);
		expect(cachedRead).not.toHaveBeenCalled();
	});

	test("closing a view cancels note scans and prevents the queued refresh from reading again", async () => {
		vi.useFakeTimers();
		let finishRead: (text: string) => void = () => {};
		const { view, cachedRead } = makeView({ "a.md": "foo" }, async () =>
			new Promise<string>((resolve) => { finishRead = resolve; }));
		const scan = view.ensureContentIndex(["foo"]);
		view.handleMetadataResolved();
		view.renderer = null;
		view.layout = null;
		view.savePositions = async () => {};
		await view.onClose();
		finishRead("foo");
		await scan;
		await vi.advanceTimersByTimeAsync(2000);
		expect(view.contentIndex.size).toBe(0);
		expect(view.contentIndexJobs).toBe(0);
		expect(cachedRead).toHaveBeenCalledTimes(1);
	});
});
