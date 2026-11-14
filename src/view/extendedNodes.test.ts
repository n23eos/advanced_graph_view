import { expect, test, vi } from "vitest";
import { TFile } from "obsidian";
import { buildGraphModel } from "../data/GraphStore";
import { graphNodeFile, buildVaultGraph } from "../data/vaultGraph";
import { TooltipController, type TooltipControllerDeps } from "./tooltip";
vi.mock("obsidian", async importOriginal => ({
	...await importOriginal<object>(),
	TFile: class { path = ""; extension = ""; },
	parseLinktext: (text: string) => ({ path: text.split("#")[0], subpath: "" }),
}));
const file = (path: string) => Object.assign(new TFile(), { path, extension: path.split(".").pop() });
const note = file("folder/a.md"), attachment = file("image.png");
const files = [note, attachment];
const app = () => ({
	vault: { getMarkdownFiles: () => [note], getFiles: () => files, getAbstractFileByPath: vi.fn((path: string) => files.find(f => f.path === path) ?? null), cachedRead: vi.fn(async () => "body") },
	metadataCache: { resolvedLinks: {}, unresolvedLinks: { [note.path]: { Ghost: 1 } }, getFirstLinkpathDest: vi.fn((): TFile | null => null) },
});
test("both views can resolve current cache targets through one inventory adapter", () => {
	const a = app(); a.metadataCache.getFirstLinkpathDest.mockReturnValue(attachment);
	const model = buildVaultGraph(a as unknown as Parameters<typeof buildVaultGraph>[0], { attachments: false, unresolved: true });
	expect(a.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("Ghost", note.path);
	expect(model.nodes.some(n => n.kind === "unresolved")).toBe(false);
	expect(model.pathToId.has(attachment.path)).toBe(true);
});
test("missing target opens its source without looking up the virtual identity", () => {
	const a = app();
	const model = buildVaultGraph(a as unknown as Parameters<typeof buildVaultGraph>[0], { attachments: false, unresolved: true });
	const missing = model.nodes.find(n => n.kind === "unresolved")!;
	expect(graphNodeFile(a as unknown as Parameters<typeof graphNodeFile>[0], missing)).toBe(note);
	expect(a.vault.getAbstractFileByPath.mock.calls.every(([path]) => !path.includes("\0"))).toBe(true);
	a.metadataCache.getFirstLinkpathDest.mockReturnValue(attachment);
	expect(graphNodeFile(a as unknown as Parameters<typeof graphNodeFile>[0], missing)).toBe(attachment);
});
test("attachment and virtual previews never read note bodies", async () => {
	const a = app();
	const model = buildGraphModel([attachment.path], {}, { [note.path]: { Ghost: 1 } }, {
		scope: { attachments: true, unresolved: true }, attachmentPaths: [attachment.path], sourcePaths: new Set([note.path]),
	});
	const controller = new TooltipController({ getApp: () => a, getModel: () => model } as unknown as TooltipControllerDeps);
	await controller.notePreview(0, 10);
	await controller.notePreview(model.nodes.find(n => n.kind === "unresolved")!.id, 10);
	expect(a.vault.cachedRead).not.toHaveBeenCalled();
	expect(a.vault.getAbstractFileByPath.mock.calls.every(([path]) => !path.includes("\0"))).toBe(true);
});
