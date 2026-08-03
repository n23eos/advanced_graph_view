import { describe, expect, test } from "vitest";
import { buildAdjacency, computeDistances, focusFalloff, shortestPath } from "./focus";
import { pointInPolygon } from "./geometry";
import { buildGraphModel } from "../data/GraphStore";

describe("computeDistances", () => {
	// chain: a -> b -> c -> d, e isolated
	const model = buildGraphModel(
		["a.md", "b.md", "c.md", "d.md", "e.md"],
		{ "a.md": { "b.md": 1 }, "b.md": { "c.md": 1 }, "c.md": { "d.md": 1 } },
		{}
	);
	const adjacency = buildAdjacency(model);

	test("BFS distances ignore link direction", () => {
		// Act: root = c (index 2)
		const distances = computeDistances(adjacency, model.nodes.length, 2, 4);

		// Assert
		expect(Array.from(distances)).toEqual([2, 1, 0, 1, -1]); // e unreachable
	});

	test("depth limits the neighborhood", () => {
		const distances = computeDistances(adjacency, model.nodes.length, 0, 1);
		expect(Array.from(distances)).toEqual([0, 1, -1, -1, -1]);
	});
});

describe("pointInPolygon", () => {
	const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

	test("inside and outside", () => {
		expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
		expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
	});

	test("concave polygon", () => {
		// U-shape: notch at the top middle
		const u = [
			{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 8, y: 10 },
			{ x: 8, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
		];
		expect(pointInPolygon({ x: 6, y: 8 }, u)).toBe(false); // in the notch
		expect(pointInPolygon({ x: 2, y: 8 }, u)).toBe(true); // left arm
	});
});

describe("shortestPath", () => {
	// a-b-c-d chain, plus shortcut a-d? no. e isolated.
	const chain = buildGraphModel(
		["a.md", "b.md", "c.md", "d.md", "e.md"],
		{ "a.md": { "b.md": 1 }, "b.md": { "c.md": 1 }, "c.md": { "d.md": 1 } },
		{}
	);
	const adj = buildAdjacency(chain);

	test("returns the full chain between endpoints", () => {
		expect(Array.from(shortestPath(adj, 5, 0, 3))).toEqual([0, 1, 2, 3]);
	});

	test("works in the reverse direction (links are undirected here)", () => {
		expect(Array.from(shortestPath(adj, 5, 3, 0))).toEqual([3, 2, 1, 0]);
	});

	test("same node returns itself", () => {
		expect(shortestPath(adj, 5, 2, 2)).toEqual([2]);
	});

	test("disconnected nodes return an empty path", () => {
		expect(shortestPath(adj, 5, 0, 4)).toEqual([]);
	});
});

describe("focusFalloff", () => {
	test("the root note stays at full brightness", () => {
		expect(focusFalloff(0, 3)).toBe(1);
	});

	test("notes outside the chosen depth fade to the background", () => {
		expect(focusFalloff(-1, 3)).toBeLessThan(0.1);
	});

	test("each further step is dimmer than the one before it", () => {
		const steps = [0, 1, 2, 3, 4, 5, 6].map((d) => focusFalloff(d, 6));

		for (let i = 1; i < steps.length; i++) {
			expect(steps[i]).toBeLessThan(steps[i - 1]);
		}
	});

	test("the slider stretches the ramp: step 3 of 6 is brighter than step 3 of 3", () => {
		// The bug: a fixed 4-entry table flattened everything past step 3, so
		// widening the slider added notes at an identical, indistinguishable dim.
		expect(focusFalloff(3, 6)).toBeGreaterThan(focusFalloff(3, 3));
	});

	test("the last step in range stays clearly above the out-of-range fade", () => {
		expect(focusFalloff(6, 6)).toBeGreaterThan(focusFalloff(-1, 6) * 3);
	});

	test("a single-step neighborhood still separates root from neighbors", () => {
		expect(focusFalloff(1, 1)).toBeLessThan(focusFalloff(0, 1));
		expect(focusFalloff(1, 1)).toBeGreaterThan(focusFalloff(-1, 1));
	});
});
