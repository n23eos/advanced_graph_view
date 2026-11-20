import { describe, expect, test } from "vitest";
import { LabelCollisionGrid, overlapsAny } from "./labelCollision";

describe("label collision", () => {
	const occupied = [{ x: 10, y: 10, width: 20, height: 10 }];

	test("detects a real overlap", () => {
		expect(overlapsAny({ x: 20, y: 15, width: 20, height: 10 }, occupied)).toBe(true);
	});

	test("allows touching edges and separated labels", () => {
		expect(overlapsAny({ x: 30, y: 10, width: 20, height: 10 }, occupied)).toBe(false);
		expect(overlapsAny({ x: 0, y: 30, width: 5, height: 5 }, occupied)).toBe(false);
	});

	test("grid matches legacy overlap semantics across cell boundaries", () => {
		const grid = new LabelCollisionGrid(16);
		grid.insert({ x: 10, y: 10, width: 20, height: 10 });

		expect(grid.overlaps({ x: 20, y: 15, width: 20, height: 10 })).toBe(true);
		expect(grid.overlaps({ x: 30, y: 10, width: 20, height: 10 })).toBe(false);
		expect(grid.overlaps({ x: -20, y: -20, width: 5, height: 5 })).toBe(false);
	});

	test("reuses cleared cells and inserts only accepted boxes", () => {
		const grid = new LabelCollisionGrid(32);

		expect(grid.tryInsert({ x: 0, y: 0, width: 20, height: 10 })).toBe(true);
		expect(grid.tryInsert({ x: 5, y: 5, width: 20, height: 10 })).toBe(false);
		expect(grid.size).toBe(1);

		grid.clear();

		expect(grid.size).toBe(0);
		expect(grid.tryInsert({ x: 5, y: 5, width: 20, height: 10 })).toBe(true);
	});
});
