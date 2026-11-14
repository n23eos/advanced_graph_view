import { describe, expect, test } from "vitest";
import { buildGraphModel } from "../data/GraphStore";
import { buildNeighborSeed } from "./neighborSeed";

describe("buildNeighborSeed", () => {
	test("places a new node near the mean of its distinct known neighbors", () => {
		const model = buildGraphModel(
			["left.md", "right.md", "new.md"],
			{
				"left.md": { "new.md": 1 },
				"new.md": { "left.md": 1, "right.md": 3 },
			},
			{},
		);
		const known = new Map([
			[0, [100, 40, 30] as const],
			[1, [200, 160, 70] as const],
		]);

		const seed = buildNeighborSeed(model, known);

		expect([...seed.slice(0, 6)]).toEqual([100, 40, 30, 200, 160, 70]);
		expect(seed[6]).toBeGreaterThanOrEqual(140);
		expect(seed[6]).toBeLessThanOrEqual(160);
		expect(seed[7]).toBeGreaterThanOrEqual(90);
		expect(seed[7]).toBeLessThanOrEqual(110);
		expect([seed[6], seed[7]]).not.toEqual([150, 100]);
		expect(seed[8]).toBe(50);
	});

	test("does not propagate positions through other new nodes", () => {
		const model = buildGraphModel(
			["known.md", "near.md", "far.md"],
			{
				"known.md": { "near.md": 1 },
				"near.md": { "far.md": 1 },
			},
			{},
		);

		const seed = buildNeighborSeed(model, new Map([[0, [500, 600, 80] as const]]));

		expect(seed[3]).toBeGreaterThanOrEqual(490);
		expect(seed[3]).toBeLessThanOrEqual(510);
		expect(seed[4]).toBeGreaterThanOrEqual(590);
		expect(seed[4]).toBeLessThanOrEqual(610);
		expect(seed[5]).toBe(80);
		expect([...seed.slice(6, 9)]).toEqual([-8, 4, 0]);
	});

	test("uses the legacy fallback when no known neighbor exists", () => {
		const model = buildGraphModel(["a.md", "b.md"], {}, {});

		const seed = buildNeighborSeed(model, new Map([[0, [0, 0, 0] as const]]));

		expect([...seed]).toEqual([0, 0, 0, -9, -3, 0]);
	});

	test("is deterministic and independent of edge order", () => {
		const model = buildGraphModel(
			["a.md", "b.md", "new.md"],
			{
				"a.md": { "new.md": 1 },
				"b.md": { "new.md": 1 },
			},
			{},
		);
		const reordered = { ...model, edges: [...model.edges].reverse() };
		const known = new Map([
			[0, [10, 20, 30] as const],
			[1, [30, 40, 50] as const],
		]);

		const first = buildNeighborSeed(model, known);
		const second = buildNeighborSeed(model, known);
		const reorderedSeed = buildNeighborSeed(reordered, known);

		expect([...second]).toEqual([...first]);
		expect([...reorderedSeed]).toEqual([...first]);
	});
});
