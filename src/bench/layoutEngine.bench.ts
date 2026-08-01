/**
 * Baseline for one simulation tick inside the layout worker.
 *
 * Measured through the message protocol rather than by reaching into the
 * engine, because that is also what step 3 changes: the tick cost today
 * includes allocating a fresh positions buffer to post back, and the ping-pong
 * rewrite should show up here as the allocation disappearing.
 */
import { bench, describe } from "vitest";
import { createLayoutEngine, type PhysicsParams } from "../workers/layoutEngine";
import { makeSyntheticGraph } from "./synthGraph";

const SIZES = [3_000, 10_000];

const PARAMS: PhysicsParams = {
	repel: 50,
	linkDistance: 40,
	centering: 0.04,
	linkStrength: 0.4,
	velocityDecay: 0.4,
	elasticity: 0.4,
	freeLayout: false,
	collideRadius: 0,
};

for (const size of SIZES) {
	const graph = makeSyntheticGraph(size);

	describe(`layout tick · ${size} nodes / ${graph.edgePairs.length / 2} edges`, () => {
		for (const dimensions of [2, 3] as const) {
			// Paused: no timer runs, so every tick comes from an explicit "step"
			// and the benchmark measures exactly the work it asked for.
			const engine = createLayoutEngine(() => {});
			engine.handle({
				type: "init",
				nodeCount: size,
				edges: graph.edgePairs.slice(),
				weights: graph.weights.slice(),
				positions: graph.positions.slice(),
				dimensions,
				paused: true,
			});
			engine.handle({ type: "params", params: PARAMS });

			bench(`${dimensions}D single tick`, () => {
				engine.handle({ type: "step" });
			});
		}
	});
}
