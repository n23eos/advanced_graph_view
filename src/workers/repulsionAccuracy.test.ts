import { describe, expect, test } from "vitest";
import { SETTLED_THETA, repulsionTheta } from "./repulsionAccuracy";

describe("repulsionTheta", () => {
	test("a hot, chaotic layout uses the cheapest approximation", () => {
		// Right after a reheat nodes are flying across the screen; nobody can
		// see the difference between exact and approximate repulsion there.
		expect(repulsionTheta(1)).toBeGreaterThan(SETTLED_THETA);
		expect(repulsionTheta(0.5)).toBeGreaterThan(SETTLED_THETA);
	});

	test("a settling layout tightens back to the accurate value", () => {
		// This is the value the layout's final shape was tuned around: coarse
		// repulsion at rest is what makes nodes buzz instead of gliding to a stop.
		expect(repulsionTheta(0.02)).toBe(SETTLED_THETA);
		expect(repulsionTheta(0)).toBe(SETTLED_THETA);
	});

	test("accuracy never decreases as the layout cools", () => {
		let previous = repulsionTheta(1);
		for (let alpha = 1; alpha >= 0; alpha -= 0.01) {
			const theta = repulsionTheta(alpha);
			expect(theta).toBeLessThanOrEqual(previous + 1e-9);
			previous = theta;
		}
	});

	test("stays within Barnes-Hut's usable range", () => {
		for (let alpha = 0; alpha <= 1; alpha += 0.01) {
			const theta = repulsionTheta(alpha);
			expect(theta).toBeGreaterThan(0);
			expect(theta).toBeLessThanOrEqual(1.2);
		}
	});
});
