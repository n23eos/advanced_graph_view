import { describe, expect, test } from "vitest";
import { buildAdjacency, computeDistances } from "./focus";
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
