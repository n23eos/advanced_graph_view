import { TFile, parseLinktext, type App } from "obsidian";
import { buildGraphModel, type GraphModel, type GraphNode } from "./GraphStore";
import { normalizeGraphScope, type GraphScope } from "./graphScope";

/** One inventory/resolution policy for the main and local graph. */
export function buildVaultGraph(app: Pick<App, "vault" | "metadataCache">, rawScope?: GraphScope): GraphModel {
	const notes = app.vault.getMarkdownFiles().map(file => file.path);
	const cache = app.metadataCache;
	const scope = normalizeGraphScope(rawScope);
	if (!scope.attachments && !scope.unresolved) return buildGraphModel(notes, cache.resolvedLinks, cache.unresolvedLinks);
	const files = app.vault.getFiles();
	const existing = new Set(files.map(file => file.path));
	return buildGraphModel(notes, cache.resolvedLinks, cache.unresolvedLinks, {
		scope,
		attachmentPaths: files.filter(file => file.extension !== "md").map(file => file.path).sort(),
		sourcePaths: new Set(notes),
		resolveTarget: (linkpath, sourcePath) => {
			const file = cache.getFirstLinkpathDest(parseLinktext(linkpath).path, sourcePath);
			return file && existing.has(file.path) ? file.path : null;
		},
	});
}

/** A missing node can navigate to its source, but never creates a file. */
export function graphNodeFile(app: Pick<App, "vault" | "metadataCache">, node: GraphNode): TFile | null {
	if (node.unresolved) {
		const resolved = app.metadataCache.getFirstLinkpathDest(parseLinktext(node.unresolved.linkpath).path, node.unresolved.sourcePath);
		if (resolved instanceof TFile) {
			const current = app.vault.getAbstractFileByPath(resolved.path);
			if (current instanceof TFile) return current;
		}
	}
	const path = node.unresolved?.sourcePath ?? node.path;
	if (path.includes("\0")) return null;
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}
