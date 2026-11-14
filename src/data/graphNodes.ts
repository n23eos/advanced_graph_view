import type { GraphNode } from "./GraphStore";
import { t } from "../i18n";

/** Decode only our reserved, non-file identity. Also supports removed snapshot nodes. */
export function unresolvedIdentity(path: string): GraphNode["unresolved"] | null {
	if (!path.startsWith("\0unresolved:")) return null;
	try {
		const value: unknown = JSON.parse(path.slice("\0unresolved:".length));
		if (Array.isArray(value) && value.length === 2 && value.every(v => typeof v === "string")) {
			return { sourcePath: value[0], linkpath: value[1] };
		}
	} catch { /* A malformed identity is not a filesystem path. */ }
	return null;
}
export function displayGraphPath(path: string): string {
	const missing = unresolvedIdentity(path);
	return missing ? t("nodes.missing", { target: missing.linkpath, source: missing.sourcePath }) : path.replace(/\0/g, "");
}
export function nodeDisplayPath(node: GraphNode): string { return displayGraphPath(node.path); }
export function nodeSourcePath(node: GraphNode): string { return node.unresolved?.sourcePath ?? node.path; }

export function isAttachmentNode(node: GraphNode): boolean {
	return node.kind === "attachment" || (node.kind === undefined && !node.path.toLowerCase().endsWith(".md"));
}

/** Missing links keep their original context instead of creating links relative to the export. */
export function nodeMarkdown(node: GraphNode): string {
	if (node.unresolved) {
		const label = node.unresolved.linkpath.replace(/([\\`*_[\]<>])/g, "\\$1").replace(/[\r\n]/g, " ");
		return `${label} (${t("nodes.openSource")}: [[${node.unresolved.sourcePath}]])`;
	}
	return `[[${node.kind || isAttachmentNode(node) ? node.path : node.name}]]`;
}
