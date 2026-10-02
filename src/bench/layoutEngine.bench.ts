/**
 * Baseline for one simulation tick inside the layout worker.
 *
 * Measured through the message protocol, including the positions snapshot.
 * Keep alpha fixed so warmup and later samples cannot cool into no-op steps.
 */
import { afterAll, bench, describe } from "vitest";
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
			let ticks = 0;
			const engine = createLayoutEngine((message) => {
				if (message.type === "tick") ticks++;
			});
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
			afterAll(() => engine.handle({ type: "stop" }));

			bench(`${dimensions}D single tick`, () => {
				const before = ticks;
				engine.handle({ type: "reheat", alpha: 0.3 });
				engine.handle({ type: "step" });
				if (ticks !== before + 1) throw new Error("benchmark step did not emit a tick");
			});
		}
	});
}
