import type { GraphNode } from "../data/GraphStore";

export interface GraphFolder {
	path: string;
	name: string;
	ids: number[];
}

export function groupGraphFolders(
	nodes: readonly GraphNode[],
	mode: "top" | "parent" = "top"
): GraphFolder[] {
	const byPath = new Map<string, GraphFolder>();
	for (const node of nodes) {
		if (node.kind === "unresolved") continue;
		const separator = mode === "top" ? node.path.indexOf("/") : node.path.lastIndexOf("/");
		if (separator < 1) continue;
		const path = node.path.slice(0, separator);
		let group = byPath.get(path);
		if (!group) {
			group = { path, name: path.slice(path.lastIndexOf("/") + 1), ids: [] };
			byPath.set(path, group);
		}
		group.ids.push(node.id);
	}
	return Array.from(byPath.values()).sort((a, b) =>
		b.ids.length - a.ids.length || a.path.localeCompare(b.path));
}
