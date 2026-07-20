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
