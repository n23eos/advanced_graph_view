import type { GraphModel } from "../data/GraphStore";
import { seededRandom } from "../util/seededRandom";

export type SeedPosition = readonly [number, number, number];

const JITTER_RADIUS = 10;

/** Build a carry-over seed while keeping new nodes close to known neighbors. */
export function buildNeighborSeed(
	model: Pick<GraphModel, "nodes" | "edges">,
	knownPositions: ReadonlyMap<number, SeedPosition>,
): Float32Array {
	const seed = new Float32Array(model.nodes.length * 3);
	const neighbors = Array.from({ length: model.nodes.length }, () => new Set<number>());
	for (const edge of model.edges) {
		neighbors[edge.source].add(edge.target);
		neighbors[edge.target].add(edge.source);
	}

	for (const node of model.nodes) {
		const offset = node.id * 3;
		const known = knownPositions.get(node.id);
		if (known) {
			seed[offset] = known[0];
			seed[offset + 1] = known[1];
			seed[offset + 2] = known[2];
			continue;
		}

		const placedNeighbors = [...neighbors[node.id]]
			.filter((id) => knownPositions.has(id))
			.sort((a, b) => a - b);
		if (placedNeighbors.length === 0) {
			seed[offset] = (node.id % 20) - 10;
			seed[offset + 1] = ((node.id * 7) % 20) - 10;
			continue;
		}

		let x = 0;
		let y = 0;
		let z = 0;
		for (const id of placedNeighbors) {
			const position = knownPositions.get(id)!;
			x += position[0];
			y += position[1];
			z += position[2];
		}
		const random = seededRandom(node.id);
		seed[offset] = x / placedNeighbors.length + (random() * 2 - 1) * JITTER_RADIUS;
		seed[offset + 1] = y / placedNeighbors.length + (random() * 2 - 1) * JITTER_RADIUS;
		seed[offset + 2] = z / placedNeighbors.length;
	}

	return seed;
}
