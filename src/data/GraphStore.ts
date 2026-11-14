import { sameGraphScope, type GraphScope } from "./graphScope";
/**
 * Pure graph model builder. Independent from the Obsidian API so it can be
 * unit-tested; GraphView feeds it data from app.metadataCache.
 */

export interface GraphNode {
	kind?: "note" | "attachment" | "unresolved";
	unresolved?: { sourcePath: string; linkpath: string };
	id: number;
	path: string;
	name: string;
	inCount: number;
	outCount: number;
	unresolvedCount: number;
}

export interface GraphEdge {
	source: number;
	target: number;
	weight: number;
}

export interface GraphModel {
	scope?: GraphScope;
	nodes: GraphNode[];
	edges: GraphEdge[];
	pathToId: Map<string, number>;
}

/** Link map shape from metadataCache.resolvedLinks / unresolvedLinks. */
export type LinkMap = Record<string, Record<string, number>>;

/** Same node ids, link topology and counts consumed by the graph view. */
export function sameGraphModel(a: GraphModel, b: GraphModel): boolean {
	if (!sameGraphScope(a.scope, b.scope)) return false;
	if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
	for (let i = 0; i < a.nodes.length; i++) {
		const left = a.nodes[i];
		const right = b.nodes[i];
		if (left.kind !== right.kind || left.path !== right.path || left.inCount !== right.inCount ||
			left.outCount !== right.outCount || left.unresolvedCount !== right.unresolvedCount) return false;
	}
	for (let i = 0; i < a.edges.length; i++) {
		const left = a.edges[i];
		const right = b.edges[i];
		if (left.source !== right.source || left.target !== right.target || left.weight !== right.weight) {
			// Cache enumeration order can change without a topology change.
			// Allocate only on a mismatch; unchanged ordered models stay cheap.
			const counts = new Map<string, number>();
			const key = (edge: GraphEdge) => `${edge.source}:${edge.target}:${edge.weight}`;
			for (const edge of a.edges) {
				const id = key(edge);
				counts.set(id, (counts.get(id) ?? 0) + 1);
			}
			for (const edge of b.edges) {
				const id = key(edge);
				const count = counts.get(id);
				if (count === undefined) return false;
				if (count === 1) counts.delete(id);
				else counts.set(id, count - 1);
			}
			return counts.size === 0;
		}
	}
	return true;
}

function basenameWithoutExtension(path: string): string {
	const base = path.slice(path.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

export interface GraphBuildOptions {
	scope: GraphScope;
	attachmentPaths: readonly string[];
	sourcePaths: ReadonlySet<string>;
	resolveTarget?: (linkpath: string, sourcePath: string) => string | null;
}

export function buildGraphModel(
	files: readonly string[],
	resolvedLinks: LinkMap,
	unresolvedLinks: LinkMap,
	options?: GraphBuildOptions
): GraphModel {
	const pathToId = new Map<string, number>();
	const nodes: GraphNode[] = [];

	const addNode = (path: string): number => {
		const existing = pathToId.get(path);
		if (existing !== undefined) return existing;
		const id = nodes.length;
		pathToId.set(path, id);
		nodes.push({
			id,
			path,
			name: basenameWithoutExtension(path),
			inCount: 0,
			outCount: 0,
			unresolvedCount: 0,
		});
		return id;
	};

	for (const path of files) addNode(path);

	const edges: GraphEdge[] = [];
	for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
		const source = addNode(sourcePath);
		for (const [targetPath, weight] of Object.entries(targets)) {
			if (targetPath === sourcePath) continue;
			const target = addNode(targetPath);
			edges.push({ source, target, weight });
		}
	}

	// Degree counts distinct linked notes, matching the core graph's behavior;
	// edge.weight still carries the repeat-link count for rendering.
	for (const edge of edges) {
		nodes[edge.source].outCount += 1;
		nodes[edge.target].inCount += 1;
	}

	for (const [sourcePath, targets] of Object.entries(unresolvedLinks)) {
		const source = addNode(sourcePath);
		let count = 0;
		for (const linkCount of Object.values(targets)) count += linkCount;
		nodes[source].unresolvedCount = count;
	}

	if (!options || (!options.scope.attachments && !options.scope.unresolved)) return { nodes, edges, pathToId };
	const attachments = new Set(options.attachmentPaths);
	if (options.scope.attachments) for (const path of options.attachmentPaths) addNode(path);
	for (const node of nodes) node.kind = attachments.has(node.path) ? "attachment" : "note";
	if (options.scope.unresolved) {
		const legacyPairs = new Set(edges.map(edge => `${edge.source}:${edge.target}`));
		const addedPairs = new Map<string, GraphEdge>();
		for (const [sourcePath, targets] of Object.entries(unresolvedLinks)) {
			if (!options.sourcePaths.has(sourcePath)) continue;
			const source = pathToId.get(sourcePath)!;
			for (const [linkpath, weight] of Object.entries(targets)) {
				const resolved = options.resolveTarget?.(linkpath, sourcePath);
				const path = resolved ?? `\0unresolved:${JSON.stringify([sourcePath, linkpath])}`;
				const target = addNode(path);
				const node = nodes[target];
				if (resolved) node.kind = attachments.has(path) ? "attachment" : "note";
				else {
					node.kind = "unresolved";
					node.unresolved = { sourcePath, linkpath };
					node.name = linkpath;
				}
				const pair = `${source}:${target}`;
				if (source === target || legacyPairs.has(pair)) continue;
				const existing = addedPairs.get(pair);
				if (existing) { existing.weight += weight; continue; }
				const edge = { source, target, weight };
				addedPairs.set(pair, edge);
				edges.push(edge);
				nodes[source].outCount++;
				nodes[target].inCount++;
			}
		}
	}
	return { nodes, edges, pathToId, scope: { ...options.scope } };
}
