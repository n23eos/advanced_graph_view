import { describe, expect, test } from "vitest";
import { makeSyntheticGraph } from "./synthGraph";

describe("makeSyntheticGraph", () => {
	test("produces the requested node count", () => {
		const graph = makeSyntheticGraph(500);

		expect(graph.nodeCount).toBe(500);
		expect(graph.positions.length).toBe(500 * 3);
	});

	test("is deterministic — same size gives byte-identical output", () => {
		const first = makeSyntheticGraph(300);
		const second = makeSyntheticGraph(300);

		expect(Array.from(second.edgePairs)).toEqual(Array.from(first.edgePairs));
		expect(Array.from(second.positions)).toEqual(Array.from(first.positions));
	});

	test("every edge endpoint is a real node and never a self-loop", () => {
		const { nodeCount, edgePairs } = makeSyntheticGraph(400);

		for (let e = 0; e < edgePairs.length / 2; e++) {
			const source = edgePairs[e * 2];
			const target = edgePairs[e * 2 + 1];
			expect(source).toBeLessThan(nodeCount);
			expect(target).toBeLessThan(nodeCount);
			expect(source).not.toBe(target);
		}
	});

	test("weights line up one-per-edge", () => {
		const { edgePairs, weights } = makeSyntheticGraph(200);

		expect(weights.length).toBe(edgePairs.length / 2);
	});

	test("degrees are skewed, not uniform — a few hubs carry the graph", () => {
		// Preferential attachment is the point: a vault has a handful of index
		// notes with hundreds of links and a long tail of leaves. A uniform
		// random graph would benchmark the wrong shape.
		const { nodeCount, edgePairs } = makeSyntheticGraph(1000);
		const degrees = new Uint32Array(nodeCount);
		for (let i = 0; i < edgePairs.length; i++) degrees[edgePairs[i]]++;

		const sorted = Array.from(degrees).sort((a, b) => b - a);
		const topShare = sorted.slice(0, Math.floor(nodeCount * 0.05))
			.reduce((sum, d) => sum + d, 0) / edgePairs.length;

		expect(topShare).toBeGreaterThan(0.2);
	});

	test("screen projection returns one xy pair and one radius per node", () => {
		const graph = makeSyntheticGraph(250);
		const screen = graph.projectToScreen();

		expect(screen.positions.length).toBe(250 * 2);
		expect(screen.radii.length).toBe(250);
	});
});
