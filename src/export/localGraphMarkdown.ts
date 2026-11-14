import { isAttachmentNode, nodeMarkdown } from "../data/graphNodes";
/**
 * Markdown rendering of a note's local neighborhood: one heading per BFS ring,
 * direction arrows on the first ring, and the note each deeper hop was reached
 * through. Pure string building — the pane decides where the file goes.
 */
import { t } from "../i18n";
import type { Neighborhood } from "../analysis/neighborhood";

/** First-ring arrow: outgoing, incoming, or mutual link with the root. */
function directionArrow(rootOut: Set<number>, rootIn: Set<number>, nodeId: number): string {
	const out = rootOut.has(nodeId);
	if (out && rootIn.has(nodeId)) return "↔";
	return out ? "→" : "←";
}

export function localGraphMarkdown(neighborhood: Neighborhood): string {
	const { model, depths, parents, rootId } = neighborhood;
	// One pass over the edges instead of one per first-ring node.
	const rootOut = new Set<number>();
	const rootIn = new Set<number>();
	for (const edge of model.edges) {
		if (edge.source === rootId) rootOut.add(edge.target);
		if (edge.target === rootId) rootIn.add(edge.source);
	}
	const root = model.nodes[rootId];
	let maxDepth = 0;
	for (const depth of depths) maxDepth = Math.max(maxDepth, depth);

	const title = root.kind || isAttachmentNode(root)
		? t("localGraph.mdTitleNode", { node: nodeMarkdown(root), depth: String(maxDepth) })
		: t("localGraph.mdTitle", { name: root.name, depth: String(maxDepth) });
	const lines = [`# ${title}`];

	for (let depth = 1; depth <= maxDepth; depth++) {
		const ring = model.nodes
			.filter((node) => depths[node.id] === depth)
			.sort((a, b) => a.name.localeCompare(b.name));
		if (ring.length === 0) continue;

		lines.push("", `## ${t("localGraph.mdLevel", { depth: String(depth) })}`);
		for (const node of ring) {
			if (depth === 1) {
				lines.push(`- ${directionArrow(rootOut, rootIn, node.id)} ${nodeMarkdown(node)}`);
				continue;
			}
			const parent = model.nodes[parents[node.id]];
			lines.push(
				parent
					? `- ${nodeMarkdown(node)} (${t("localGraph.mdVia")} ${nodeMarkdown(parent)})`
					: `- ${nodeMarkdown(node)}`
			);
		}
	}

	return lines.join("\n") + "\n";
}
