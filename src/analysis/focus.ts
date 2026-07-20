/** Focus mode: undirected BFS distances from a root node. */
import type { GraphModel } from "../data/GraphStore";

export type Adjacency = number[][];

export function buildAdjacency(model: GraphModel): Adjacency {
	const adjacency: Adjacency = Array.from({ length: model.nodes.length }, () => []);
	for (const edge of model.edges) {
		adjacency[edge.source].push(edge.target);
		adjacency[edge.target].push(edge.source);
	}
	return adjacency;
}

/** -1 = beyond maxDepth / unreachable. */
export function computeDistances(
	adjacency: Adjacency,
	nodeCount: number,
	rootId: number,
	maxDepth: number
): Int16Array {
	const distances = new Int16Array(nodeCount).fill(-1);
	distances[rootId] = 0;
	let frontier = [rootId];
	for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
		const next: number[] = [];
		for (const id of frontier) {
			for (const neighbor of adjacency[id]) {
				if (distances[neighbor] === -1) {
					distances[neighbor] = depth;
					next.push(neighbor);
				}
			}
		}
		frontier = next;
	}
	return distances;
}
