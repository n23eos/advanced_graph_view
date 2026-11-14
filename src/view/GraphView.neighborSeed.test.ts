// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { GraphInsightView } from "./GraphView";

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
	renderer: { currentPositions: Float32Array | null };
	buildSeedPositions(
		model: GraphModel,
		renamed?: ReadonlyMap<string, string>,
	): Promise<{ seed: Float32Array | undefined; pinnedPaths: string[] }>;
}

function build(saved: unknown = null): Internals {
	const app = {
		vault: { getMarkdownFiles: () => [] },
		metadataCache: { resolvedLinks: {}, unresolvedLinks: {} },
	};
	const plugin = {
		settings: DEFAULT_SETTINGS,
		usageLog: {},
		dataStore: { loadPositions: vi.fn(async () => saved) },
	};
	const view = new GraphInsightView(
		{ app } as unknown as WorkspaceLeaf,
		plugin as never,
	) as unknown as Internals;
	view.renderer = { currentPositions: null };
	return view;
}

describe("GraphInsightView neighbor seed", () => {
	test("maps live coordinates by path before placing a new neighbor", async () => {
		const view = build();
		view.model = buildGraphModel(["removed.md", "anchor.md"], {}, {});
		view.renderer.currentPositions = new Float32Array([1, 2, 3, 100, 200, 60]);
		const next = buildGraphModel(
			["anchor.md", "new.md"],
			{ "anchor.md": { "new.md": 1 } },
			{},
		);

		const { seed } = await view.buildSeedPositions(next);

		expect(seed).toBeDefined();
		expect([...seed!.slice(0, 3)]).toEqual([100, 200, 60]);
		expect(seed![3]).toBeGreaterThanOrEqual(90);
		expect(seed![3]).toBeLessThanOrEqual(110);
		expect(seed![4]).toBeGreaterThanOrEqual(190);
		expect(seed![4]).toBeLessThanOrEqual(210);
		expect(seed![5]).toBe(60);
	});

	test("resolves saved coordinates through a rename before placing a neighbor", async () => {
		const view = build({
			positions: { "old-anchor.md": [300, 400, 90] },
			pins: [],
		});
		const next = buildGraphModel(
			["anchor.md", "new.md"],
			{ "new.md": { "anchor.md": 1 } },
			{},
		);

		const { seed } = await view.buildSeedPositions(
			next,
			new Map([["anchor.md", "old-anchor.md"]]),
		);

		expect(seed).toBeDefined();
		expect([...seed!.slice(0, 3)]).toEqual([300, 400, 90]);
		expect(seed![3]).toBeGreaterThanOrEqual(290);
		expect(seed![3]).toBeLessThanOrEqual(310);
		expect(seed![4]).toBeGreaterThanOrEqual(390);
		expect(seed![4]).toBeLessThanOrEqual(410);
		expect(seed![5]).toBe(90);
	});

	test("keeps the first startup seed undefined without saved positions", async () => {
		const view = build();
		const next = buildGraphModel(["a.md"], {}, {});

		const result = await view.buildSeedPositions(next);

		expect(result.seed).toBeUndefined();
	});
});
