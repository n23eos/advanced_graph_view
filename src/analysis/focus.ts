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

/** Brightness of the farthest ring still inside the neighborhood. Well above
 *  OUT_OF_RANGE_ALPHA so "in range, far" never reads as "excluded". */
const FURTHEST_IN_RANGE_ALPHA = 0.4;
/** Everything the neighborhood does not reach — context, not content. */
const OUT_OF_RANGE_ALPHA = 0.04;

/**
 * Opacity for a note at `distance` hops from the focus root.
 *
 * The ramp is stretched across `maxDepth` rather than read from a fixed table,
 * so widening the depth slider actually spreads the rings apart instead of
 * piling every far note onto one indistinguishable dim.
 */
export function focusFalloff(distance: number, maxDepth: number): number {
	if (distance < 0) return OUT_OF_RANGE_ALPHA;
	if (distance === 0 || maxDepth <= 0) return 1;
	const t = Math.min(distance, maxDepth) / maxDepth;
	return 1 - t * (1 - FURTHEST_IN_RANGE_ALPHA);
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
