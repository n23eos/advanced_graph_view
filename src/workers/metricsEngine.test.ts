import { describe, expect, test } from "vitest";
import { computeGraphMetrics } from "./metricsEngine";

/** Flat edge pairs helper. */
function edges(pairs: [number, number][]): { edges: Uint32Array; weights: Float32Array } {
	const flat = new Uint32Array(pairs.length * 2);
	pairs.forEach(([s, t], i) => {
		flat[i * 2] = s;
		flat[i * 2 + 1] = t;
	});
	return { edges: flat, weights: new Float32Array(pairs.length).fill(1) };
}

describe("computeGraphMetrics", () => {
	test("hub of a star graph gets the highest pagerank", () => {
		// Arrange: nodes 1..4 all link to node 0
		const input = edges([[1, 0], [2, 0], [3, 0], [4, 0]]);

		// Act
		const result = computeGraphMetrics(5, input.edges, input.weights);

		// Assert
		for (let i = 1; i < 5; i++) {
			expect(result.pagerank[0]).toBeGreaterThan(result.pagerank[i]);
		}
	});

	test("pagerank covers every node with a finite value", () => {
		// Arrange: includes isolated node 3
		const input = edges([[0, 1], [1, 2]]);

		// Act
		const result = computeGraphMetrics(4, input.edges, input.weights);

		// Assert
		expect(result.pagerank).toHaveLength(4);
		expect(Array.from(result.pagerank).every((v) => Number.isFinite(v) && v > 0)).toBe(true);
	});

	test("two dense groups joined by one bridge form two communities", () => {
		// Arrange: triangle 0-1-2 and triangle 3-4-5, bridge 2-3
		const input = edges([
			[0, 1], [1, 2], [2, 0],
			[3, 4], [4, 5], [5, 3],
			[2, 3],
		]);

		// Act
		const result = computeGraphMetrics(6, input.edges, input.weights);

		// Assert
		expect(result.community[0]).toBe(result.community[1]);
		expect(result.community[1]).toBe(result.community[2]);
		expect(result.community[3]).toBe(result.community[4]);
		expect(result.community[4]).toBe(result.community[5]);
		expect(result.community[0]).not.toBe(result.community[3]);
	});

	test("isolated nodes get a community id without crashing", () => {
		// Arrange
		const input = edges([[0, 1]]);

		// Act
		const result = computeGraphMetrics(3, input.edges, input.weights);

		// Assert
		expect(result.community).toHaveLength(3);
		expect(result.community[2]).toBeGreaterThanOrEqual(0);
	});

	test("duplicate edges merge instead of throwing", () => {
		// Arrange
		const input = edges([[0, 1], [0, 1]]);

		// Act & Assert
		expect(() => computeGraphMetrics(2, input.edges, input.weights)).not.toThrow();
	});
});
