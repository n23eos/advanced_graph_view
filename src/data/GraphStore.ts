/**
 * Pure graph model builder. Independent from the Obsidian API so it can be
 * unit-tested; GraphView feeds it data from app.metadataCache.
 */

export interface GraphNode {
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
	nodes: GraphNode[];
	edges: GraphEdge[];
	pathToId: Map<string, number>;
}

/** Link map shape from metadataCache.resolvedLinks / unresolvedLinks. */
export type LinkMap = Record<string, Record<string, number>>;

/** Same node ids, link topology and counts consumed by the graph view. */
export function sameGraphModel(a: GraphModel, b: GraphModel): boolean {
	if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
	for (let i = 0; i < a.nodes.length; i++) {
		const left = a.nodes[i];
		const right = b.nodes[i];
		if (left.path !== right.path || left.inCount !== right.inCount ||
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

export function buildGraphModel(
	files: readonly string[],
	resolvedLinks: LinkMap,
	unresolvedLinks: LinkMap
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

	return { nodes, edges, pathToId };
}
