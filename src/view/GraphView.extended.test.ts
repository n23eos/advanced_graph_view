// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { TFile, type WorkspaceLeaf } from "obsidian";
import type { GraphModel } from "../data/GraphStore";
import type { NodeFacts } from "../encoding/metrics";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { buildVaultGraph } from "../data/vaultGraph";
import { GraphInsightView } from "./GraphView";
vi.mock("obsidian", async importOriginal => ({
	...await importOriginal<object>(),
	ItemView: class { app: unknown; constructor(leaf: { app: unknown }) { this.app = leaf.app; } },
	TFile: class {},
	getAllTags: () => [], debounce: (callback: () => void) => callback,
	parseLinktext: (path: string) => ({ path, subpath: "" }),
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));
test("mixed graph facts and content index use only real note metadata and bodies", async () => {
	const note = Object.assign(new TFile(), { path: "a.md", extension: "md", stat: { ctime: 100, mtime: 200, size: 3 } });
	const attachment = Object.assign(new TFile(), { path: "image.png", extension: "png", stat: { ctime: 300, mtime: 400, size: 999 } });
	const app = {
		vault: { getMarkdownFiles: () => [note], getFiles: () => [note, attachment], cachedRead: vi.fn(async () => "needle"), getAbstractFileByPath: vi.fn() },
		metadataCache: { resolvedLinks: {}, unresolvedLinks: { "a.md": { Ghost: 1 } }, getFirstLinkpathDest: () => null, getFileCache: vi.fn(() => ({ frontmatter: { status: "ready" } })) },
	};
	const settings = { ...DEFAULT_SETTINGS, graphScope: { attachments: true, unresolved: true } };
	const model = buildVaultGraph(app as never, settings.graphScope);
	const view = new GraphInsightView({ app } as unknown as WorkspaceLeaf, { settings, usageLog: {} } as never) as unknown as {
		model: GraphModel; facts: NodeFacts[]; timeline: { setTimestamps: ReturnType<typeof vi.fn> };
		buildFacts(model: GraphModel, files: TFile[]): NodeFacts[]; refreshTimelineData(): void;
		nativePreviewPath(id: number): string | null; ensureContentIndex(needles: string[]): Promise<void>;
	};
	Object.assign(view, { model, pushSearchUi: vi.fn(), recomputeVisual: vi.fn() });
	view.facts = view.buildFacts(model, [note]);
	expect(app.metadataCache.getFileCache).toHaveBeenCalledExactlyOnceWith(note);
	expect(view.facts[1]).toMatchObject({ kind: "attachment", ctime: 300, size: 999, properties: {} });
	expect(view.facts[2]).toMatchObject({ kind: "unresolved", ctime: 0, mtime: 0, properties: {} });
	view.timeline = { setTimestamps: vi.fn() };
	view.refreshTimelineData();
	expect(view.timeline.setTimestamps).toHaveBeenCalledWith([100, 300]);
	expect(view.nativePreviewPath(2)).toBeNull();
	expect(app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
	await view.ensureContentIndex(["needle"]);
	expect(app.vault.cachedRead).toHaveBeenCalledExactlyOnceWith(note);
});

test("legacy linked attachment facts use real file stats without reading note metadata", () => {
	const note = Object.assign(new TFile(), { path: "a.md", extension: "md", stat: { ctime: 100, mtime: 200, size: 3 } });
	const attachment = Object.assign(new TFile(), { path: "folder/image.png", extension: "png", parent: { path: "folder" }, stat: { ctime: 300, mtime: 400, size: 999 } });
	const app = {
		vault: { getMarkdownFiles: () => [note], getFiles: () => [note, attachment], getAbstractFileByPath: (path: string) => path === attachment.path ? attachment : note },
		metadataCache: { resolvedLinks: { "a.md": { "folder/image.png": 1 } }, unresolvedLinks: {}, getFileCache: vi.fn(() => ({})) },
	};
	const model = buildVaultGraph(app as never);
	const before = structuredClone(model);
	const view = new GraphInsightView({ app } as unknown as WorkspaceLeaf, { settings: DEFAULT_SETTINGS, usageLog: {} } as never) as unknown as {
		buildFacts(model: GraphModel, files: TFile[]): NodeFacts[];
	};
	const facts = view.buildFacts(model, [note]);
	expect(facts[1]).toMatchObject({ folder: "folder", ctime: 300, mtime: 400, size: 999 });
	expect(app.metadataCache.getFileCache).toHaveBeenCalledExactlyOnceWith(note);
	expect(model).toEqual(before);
});
