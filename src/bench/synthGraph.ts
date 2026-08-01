/**
 * Synthetic vault-shaped graphs for benchmarks.
 *
 * Deterministic on purpose: a benchmark that measures a different graph every
 * run measures noise. Everything here is driven by one seeded generator, so
 * `makeSyntheticGraph(3000)` is the same 3000 nodes on every machine and every
 * commit — which is what makes before/after numbers comparable.
 */
import { seededRandom } from "../util/seededRandom";

/** Average links per note. Roughly what a linked vault looks like in practice. */
const EDGES_PER_NODE = 4;
/** How far the initial scatter spreads, in world units. */
const SCATTER_RADIUS = 1200;
/** Node radii in the same range the renderer produces. */
const MIN_RADIUS = 2;
const MAX_RADIUS = 16;

export interface SyntheticGraph {
	nodeCount: number;
	/** Flat [source0, target0, source1, target1, ...] pairs, like the engine wants. */
	edgePairs: Uint32Array;
	weights: Float32Array;
	/** World positions, stride 3 (xyz), as seed input for the layout engine. */
	positions: Float32Array;
	/** Already-projected screen data, which is what hit-testing works on. */
	projectToScreen(): ScreenSnapshot;
}

export interface ScreenSnapshot {
	/** Screen positions, stride 2 (xy). */
	positions: Float32Array;
	/** Screen radius per node. */
	radii: Float32Array;
}

/**
 * Preferential attachment: each new note links to existing notes picked in
 * proportion to how many links they already have. That reproduces the shape a
 * real vault has — a few index notes with hundreds of links, a long tail of
 * leaves — instead of the flat degree distribution a uniform random graph gives.
 */
function buildEdges(nodeCount: number, random: () => number): Uint32Array {
	// Every entry is one endpoint of one edge, so drawing from it at random is
	// already degree-weighted — no cumulative-probability pass needed.
	const endpointPool: number[] = [];
	const pairs: number[] = [];
	const seen = new Set<number>();

	for (let node = 1; node < nodeCount; node++) {
		const linkCount = Math.max(1, Math.round(random() * EDGES_PER_NODE * 2));
		for (let i = 0; i < linkCount; i++) {
			const target = endpointPool.length === 0
				? 0
				: endpointPool[Math.floor(random() * endpointPool.length)];
			if (target === node) continue;

			// Cantor-ish key so a duplicated link is dropped rather than turning
			// into a double-weight edge the renderer would draw twice.
			const key = Math.min(node, target) * nodeCount + Math.max(node, target);
			if (seen.has(key)) continue;
			seen.add(key);

			pairs.push(node, target);
			endpointPool.push(node, target);
		}
	}

	return Uint32Array.from(pairs);
}

function buildPositions(nodeCount: number, random: () => number): Float32Array {
	const positions = new Float32Array(nodeCount * 3);
	for (let i = 0; i < nodeCount; i++) {
		positions[i * 3] = (random() - 0.5) * 2 * SCATTER_RADIUS;
		positions[i * 3 + 1] = (random() - 0.5) * 2 * SCATTER_RADIUS;
		positions[i * 3 + 2] = (random() - 0.5) * 2 * SCATTER_RADIUS;
	}
	return positions;
}

export function makeSyntheticGraph(nodeCount: number): SyntheticGraph {
	// One generator per call, re-seeded from the size, so each size is
	// reproducible on its own and sizes stay independent of call order.
	const random = seededRandom(0x5eed + nodeCount);
	const edgePairs = buildEdges(nodeCount, random);
	const positions = buildPositions(nodeCount, random);

	const weights = new Float32Array(edgePairs.length / 2);
	weights.fill(1);

	return {
		nodeCount,
		edgePairs,
		weights,
		positions,
		projectToScreen() {
			// Drop z and scale to a plausible viewport; the point is a realistic
			// spread of screen coordinates, not a faithful camera.
			const screen = new Float32Array(nodeCount * 2);
			const radii = new Float32Array(nodeCount);
			const radiusRandom = seededRandom(0xf00d + nodeCount);
			for (let i = 0; i < nodeCount; i++) {
				screen[i * 2] = positions[i * 3];
				screen[i * 2 + 1] = positions[i * 3 + 1];
				radii[i] = MIN_RADIUS + radiusRandom() * (MAX_RADIUS - MIN_RADIUS);
			}
			return { positions: screen, radii };
		},
	};
}
