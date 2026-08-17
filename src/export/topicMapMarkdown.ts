/**
 * F-12: Markdown topic map for a selection of notes. Reuses the local-graph
 * BFS shape for rooted sources (focus/explore) and renders a flat list for
 * rootless ones (lasso, cluster). Pure string building — deterministic for
 * the same input and options, except the injected timestamp.
 */
import { t } from "../i18n";
import type { GraphModel } from "../data/GraphStore";
import type { Neighborhood } from "../analysis/neighborhood";

export type TopicMapSource = "focus" | "explore" | "lasso" | "cluster";

export interface TopicMapOptions {
	source: TopicMapSource;
	/** ISO timestamp injected by the caller — keeps the body testable. */
	generatedAt: string;
	includeDirections: boolean;
	includeMetrics: boolean;
	includeInternalLinks: boolean;
	locale?: string;
}

/** Rooted sources hand in a BFS neighborhood; rootless ones a flat pick. */
export type TopicMapInput =
	| { kind: "rooted"; neighborhood: Neighborhood }
	| { kind: "flat"; model: GraphModel; nodeIds: readonly number[] };

interface Row {
	id: number;
	name: string;
	inbound: number;
	outbound: number;
}

export function topicMapMarkdown(input: TopicMapInput, options: TopicMapOptions): string {
	const { model, selected } = normalize(input);
	const inSelection = new Set(selected);
	const internal = model.edges.filter(
		(edge) => inSelection.has(edge.source) && inSelection.has(edge.target)
	);

	const rows = new Map<number, Row>();
	for (const id of selected) {
		rows.set(id, { id, name: model.nodes[id].name, inbound: 0, outbound: 0 });
	}
	for (const edge of internal) {
		rows.get(edge.source)!.outbound++;
		rows.get(edge.target)!.inbound++;
	}

	const compare = (a: string, b: string) => a.localeCompare(b, options.locale);
	const depth = input.kind === "rooted" ? maxDepth(input.neighborhood) : undefined;

	const lines: string[] = [
		"---",
		"advanced-graph-view: topic-map",
		`generated: ${options.generatedAt}`,
		`source: ${options.source}`,
		...(depth !== undefined ? [`depth: ${depth}`] : []),
		"---",
		"",
		`# ${title(input)}`,
		"",
		`## ${t("topicmap.mdOverview")}`,
		`- ${t("topicmap.mdNotes", { count: String(selected.length) })}`,
		`- ${t("topicmap.mdEdges", { count: String(internal.length) })}`,
	];

	if (options.includeMetrics) {
		const central = [...rows.values()]
			.sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound) || compare(a.name, b.name))
			.slice(0, 5);
		if (central.length > 0) {
			lines.push("", `## ${t("topicmap.mdCentral")}`);
			for (const row of central) {
				lines.push(
					`- [[${row.name}]] — ${t("topicmap.mdInOut", {
						inbound: String(row.inbound),
						outbound: String(row.outbound),
					})}`
				);
			}
		}
	}

	if (input.kind === "rooted") {
		lines.push(...ringSections(input.neighborhood, options, compare));
	} else {
		lines.push("", `## ${t("topicmap.mdSelection")}`);
		const flat = [...rows.values()].sort((a, b) => compare(a.name, b.name));
		for (const row of flat) lines.push(`- [[${row.name}]]`);
	}

	if (options.includeInternalLinks) {
		lines.push("", `## ${t("topicmap.mdInternal")}`);
		const links = internal
			.map((edge) => ({ from: model.nodes[edge.source].name, to: model.nodes[edge.target].name }))
			.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));
		for (const link of links) lines.push(`- [[${link.from}]] → [[${link.to}]]`);
	}

	return lines.join("\n") + "\n";
}

function normalize(input: TopicMapInput): { model: GraphModel; selected: number[] } {
	if (input.kind === "rooted") {
		const { model } = input.neighborhood;
		return { model, selected: model.nodes.map((node) => node.id) };
	}
	return { model: input.model, selected: [...new Set(input.nodeIds)] };
}

function title(input: TopicMapInput): string {
	if (input.kind === "rooted") {
		const root = input.neighborhood.model.nodes[input.neighborhood.rootId];
		return t("topicmap.mdTitle", { name: `[[${root.name}]]` });
	}
	return t("topicmap.mdTitleFlat", { count: String(new Set(input.nodeIds).size) });
}

function maxDepth(neighborhood: Neighborhood): number {
	let depth = 0;
	for (const d of neighborhood.depths) depth = Math.max(depth, d);
	return depth;
}

/** One "## Level N" section per BFS ring — the same shape the local-graph
 *  export uses: direction arrows on ring one, "via" parents deeper. */
function ringSections(
	neighborhood: Neighborhood,
	options: TopicMapOptions,
	compare: (a: string, b: string) => number
): string[] {
	const { model, depths, parents, rootId } = neighborhood;
	const rootOut = new Set<number>();
	const rootIn = new Set<number>();
	for (const edge of model.edges) {
		if (edge.source === rootId) rootOut.add(edge.target);
		if (edge.target === rootId) rootIn.add(edge.source);
	}
	const arrow = (nodeId: number): string => {
		const out = rootOut.has(nodeId);
		if (out && rootIn.has(nodeId)) return "↔";
		return out ? "→" : "←";
	};

	const lines: string[] = [];
	for (let depth = 1; depth <= maxDepth(neighborhood); depth++) {
		const ring = model.nodes
			.filter((node) => depths[node.id] === depth)
			.sort((a, b) => compare(a.name, b.name));
		if (ring.length === 0) continue;
		lines.push("", `## ${t("topicmap.mdLevel", { depth: String(depth) })}`);
		for (const node of ring) {
			if (depth === 1) {
				const prefix = options.includeDirections ? `${arrow(node.id)} ` : "";
				lines.push(`- ${prefix}[[${node.name}]]`);
				continue;
			}
			const parent = model.nodes[parents[node.id]];
			lines.push(
				parent
					? `- [[${node.name}]] (${t("topicmap.mdVia")} [[${parent.name}]])`
					: `- [[${node.name}]]`
			);
		}
	}
	return lines;
}

/** "Topic map.md", "Topic map 1.md", … — the first name the folder is free
 *  to take. Used by the "create a copy" conflict resolution (F-12). */
export function nextAvailableName(base: string, taken: (candidate: string) => boolean): string {
	if (!taken(base)) return base;
	for (let i = 1; ; i++) {
		const dot = base.lastIndexOf(".");
		const candidate = dot > 0 ? `${base.slice(0, dot)} ${i}${base.slice(dot)}` : `${base} ${i}`;
		if (!taken(candidate)) return candidate;
	}
}
