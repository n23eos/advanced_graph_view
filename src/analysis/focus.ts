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

/**
 * Shortest undirected path between two nodes (BFS), inclusive of both ends.
 * Empty array when they are not connected.
 */
export function shortestPath(
	adjacency: Adjacency,
	nodeCount: number,
	fromId: number,
	toId: number
): number[] {
	if (fromId === toId) return [fromId];
	const previous = new Int32Array(nodeCount).fill(-1);
	const visited = new Uint8Array(nodeCount);
	visited[fromId] = 1;
	let frontier = [fromId];

	while (frontier.length > 0) {
		const next: number[] = [];
		for (const id of frontier) {
			for (const neighbor of adjacency[id]) {
				if (visited[neighbor]) continue;
				visited[neighbor] = 1;
				previous[neighbor] = id;
				if (neighbor === toId) {
					const path = [toId];
					let cursor = toId;
					while (previous[cursor] !== -1) {
						cursor = previous[cursor];
						path.push(cursor);
					}
					return path.reverse();
				}
				next.push(neighbor);
			}
		}
		frontier = next;
	}
	return [];
}
