/**
 * Local-graph extraction: the undirected BFS neighborhood of one note, cut to
 * a maximum depth and renumbered into a standalone GraphModel the renderer and
 * layout worker can consume as-is. Pure — feeds the local 3D graph pane and
 * the Markdown export, and is unit-tested without the Obsidian runtime.
 */
import type { GraphModel, GraphNode } from "../data/GraphStore";
import { buildAdjacency, computeDistances } from "./focus";

export interface Neighborhood {
	/** Renumbered subgraph: node ids are dense 0..n-1, edges remapped. */
	model: GraphModel;
	/** BFS depth per subgraph node id; root = 0. */
	depths: Int16Array;
	/** BFS parent per subgraph node id (subgraph ids); root = -1. */
	parents: Int32Array;
	/** Subgraph id of the center note. */
	rootId: number;
	/** Subgraph id → original model id. */
	toOriginal: Int32Array;
}

export function buildNeighborhood(model: GraphModel, rootId: number, maxDepth: number): Neighborhood {
	const adjacency = buildAdjacency(model);
	const distances = computeDistances(adjacency, model.nodes.length, rootId, maxDepth);

	// Dense renumbering, in original-id order for determinism.
	const toSub = new Int32Array(model.nodes.length).fill(-1);
	const kept: GraphNode[] = [];
	const toOriginalList: number[] = [];
	for (const node of model.nodes) {
		if (distances[node.id] === -1) continue;
		toSub[node.id] = kept.length;
		toOriginalList.push(node.id);
		kept.push({ ...node, id: kept.length });
	}

	const depths = new Int16Array(kept.length);
	for (let i = 0; i < kept.length; i++) depths[i] = distances[toOriginalList[i]];

	const edges = model.edges
		.filter((edge) => toSub[edge.source] !== -1 && toSub[edge.target] !== -1)
		.map((edge) => ({ source: toSub[edge.source], target: toSub[edge.target], weight: edge.weight }));

	// BFS parent: the neighbor one ring closer, resolved on the subgraph so the
	// export can name the note each hop was reached through.
	const parents = new Int32Array(kept.length).fill(-1);
	for (let i = 0; i < kept.length; i++) {
		if (depths[i] === 0) continue;
		for (const neighbor of adjacency[toOriginalList[i]]) {
			if (distances[neighbor] === depths[i] - 1) {
				parents[i] = toSub[neighbor];
				break;
			}
		}
	}

	const pathToId = new Map<string, number>();
	for (const node of kept) pathToId.set(node.path, node.id);

	return {
		model: { nodes: kept, edges, pathToId },
		depths,
		parents,
		rootId: toSub[rootId],
		toOriginal: Int32Array.from(toOriginalList),
	};
}
