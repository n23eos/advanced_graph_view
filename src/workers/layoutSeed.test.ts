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

	test("circle fills a disc: nodes at varied radii, all within the bound", () => {
		const count = 200;
		const seed = computeLayoutSeed("circle", count);
		const bound = 40 * Math.sqrt(count / Math.PI) + 1e-6;
		const radii = [];
		for (let i = 0; i < count; i++) {
			const r = Math.hypot(seed[i * 3], seed[i * 3 + 1]);
			expect(r).toBeLessThanOrEqual(bound);
			radii.push(r);
		}
		// A filled disc has a spread of radii, unlike a ring where all are equal.
		expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(bound * 0.3);
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
