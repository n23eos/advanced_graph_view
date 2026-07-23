import { describe, expect, test } from "vitest";
import { computeLayoutSeed } from "./layoutSeed";

describe("computeLayoutSeed", () => {
	test("returns stride-3 array with z always 0", () => {
		const seed = computeLayoutSeed("grid", 5);
		expect(seed.length).toBe(15);
		for (let i = 0; i < 5; i++) expect(seed[i * 3 + 2]).toBe(0);
	});

	test("empty graph yields empty seed", () => {
		expect(computeLayoutSeed("circle", 0).length).toBe(0);
	});

	test("circle places every node at the same radius", () => {
		const count = 12;
		const seed = computeLayoutSeed("circle", count);
		const radius = Math.hypot(seed[0], seed[1]);
		for (let i = 1; i < count; i++) {
			expect(Math.hypot(seed[i * 3], seed[i * 3 + 1])).toBeCloseTo(radius, 5);
		}
	});

	test("grid lays nodes on distinct integer-spaced rows and columns", () => {
		const seed = computeLayoutSeed("grid", 9); // 3x3
		const xs = new Set<number>();
		for (let i = 0; i < 9; i++) xs.add(seed[i * 3]);
		expect(xs.size).toBe(3); // three distinct columns
	});

	test("scatter is deterministic", () => {
		const a = computeLayoutSeed("scatter", 50);
		const b = computeLayoutSeed("scatter", 50);
		expect([...a]).toEqual([...b]);
	});

	test("scatter is not a radial spiral (varied distances from origin)", () => {
		const seed = computeLayoutSeed("scatter", 100);
		const radii = [];
		for (let i = 0; i < 100; i++) radii.push(Math.hypot(seed[i * 3], seed[i * 3 + 1]));
		const min = Math.min(...radii);
		const max = Math.max(...radii);
		expect(max - min).toBeGreaterThan(0); // not all on one ring
	});
});
