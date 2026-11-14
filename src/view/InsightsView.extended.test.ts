import { expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { TFile } from "obsidian";
import { InsightsView } from "./InsightsView";
import type { GraphModel } from "../data/GraphStore";
vi.mock("obsidian", async importOriginal => ({
	...await importOriginal<object>(),
	ItemView: class { app: unknown; constructor(leaf: { app: unknown }) { this.app = leaf.app; } },
	TFile: class { path = ""; extension = "md"; },
	parseLinktext: (path: string) => ({ path, subpath: "" }),
}));
test("Insights uses the selected scope and safely opens a missing node's source", () => {
	const note = Object.assign(new TFile(), { path: "a.md" });
	const attachment = Object.assign(new TFile(), { path: "image.png", extension: "png" });
	const openFile = vi.fn();
	const app = {
		vault: { getMarkdownFiles: () => [note], getFiles: () => [note, attachment], getAbstractFileByPath: vi.fn((path: string) => path === note.path ? note : null) },
		metadataCache: { resolvedLinks: {}, unresolvedLinks: { "a.md": { Ghost: 1 } }, getFirstLinkpathDest: () => null },
		workspace: { getLeaf: () => ({ openFile }) },
	};
	const view = new InsightsView({ app } as unknown as WorkspaceLeaf, { settings: { graphScope: { attachments: true, unresolved: true } } } as never) as unknown as {
		refresh(): void; model: GraphModel; openPath(path: string): void;
	};
	view.refresh();
	expect(view.model.nodes.map(node => node.kind)).toEqual(["note", "attachment", "unresolved"]);
	view.openPath(view.model.nodes[2].path);
	expect(openFile).toHaveBeenCalledWith(note);
	expect(app.vault.getAbstractFileByPath.mock.calls.every(([path]) => !path.includes("\0"))).toBe(true);
});

vi.mock("../workers/MetricsClient", () => ({ MetricsClient: class { compute = vi.fn(); stop = vi.fn(); } }));
test("Insights resyncs inventory subscriptions across settings changes, reopen and close", async () => {
	const listeners = new Map<string, Set<() => void>>();
	const emit = (name: string) => { for (const callback of listeners.get(name) ?? []) callback(); };
	const listenerCount = () => [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0);
	const note = Object.assign(new TFile(), { path: "a.md" });
	const files = [note];
	const app = {
		vault: {
			getMarkdownFiles: () => [note], getFiles: () => files,
			on: (name: string, callback: () => void) => {
				if (!listeners.has(name)) listeners.set(name, new Set());
				listeners.get(name)!.add(callback);
				return { name, callback };
			},
			offref: ({ name, callback }: { name: string; callback: () => void }) => listeners.get(name)?.delete(callback),
		},
		metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFirstLinkpathDest: () => null },
	};
	const plugin = { settings: { graphScope: { attachments: false, unresolved: false } } };
	const view = new InsightsView({ app } as unknown as WorkspaceLeaf, plugin as never);
	Object.assign(view, { renderSkeleton: vi.fn() });
	const internal = view as unknown as { model: GraphModel };
	await view.onOpen();
	expect(listenerCount()).toBe(0);
	plugin.settings.graphScope.attachments = true;
	await view.reloadFromSettings();
	await view.reloadFromSettings();
	expect(listenerCount()).toBe(3);
	const attachment = Object.assign(new TFile(), { path: "image.png", extension: "png" });
	files.push(attachment);
	emit("create");
	expect(internal.model.pathToId.has("image.png")).toBe(true);
	attachment.path = "renamed.png";
	emit("rename");
	expect(internal.model.pathToId.has("renamed.png")).toBe(true);
	expect(internal.model.pathToId.has("image.png")).toBe(false);
	files.pop();
	emit("delete");
	expect(internal.model.nodes).toHaveLength(1);
	await view.onClose();
	expect(listenerCount()).toBe(0);
	await view.onOpen();
	expect(listenerCount()).toBe(3);
	plugin.settings.graphScope.attachments = false;
	await view.reloadFromSettings();
	expect(listenerCount()).toBe(0);
	await view.onClose();
});
