import { describe, expect, it } from "vitest";
import { LAYOUT_DENSITIES, applyLayoutDensity, matchLayoutDensity } from "./layoutDensity";
import type { PhysicsParams } from "../workers/layoutEngine";

const BASE: PhysicsParams = {
	repel: 112,
	linkDistance: 205,
	centering: 0.245,
	linkStrength: 0.08,
	velocityDecay: 0.45,
	elasticity: 0.35,
	freeLayout: true,
	disabled: false,
};

describe("applyLayoutDensity", () => {
	it("packs nodes closer for the dense preset", () => {
		const next = applyLayoutDensity(BASE, "dense");

		expect(next.repel).toBeLessThan(BASE.repel);
		expect(next.linkDistance).toBeLessThan(BASE.linkDistance);
	});

	it("spreads nodes further for the loose preset", () => {
		const next = applyLayoutDensity(BASE, "loose");

		expect(next.repel).toBeGreaterThan(BASE.repel);
		expect(next.linkDistance).toBeGreaterThan(BASE.linkDistance);
	});

	it("leaves the parameters the preset does not own untouched", () => {
		const next = applyLayoutDensity(BASE, "dense");

		expect(next.centering).toBe(BASE.centering);
		expect(next.velocityDecay).toBe(BASE.velocityDecay);
		expect(next.elasticity).toBe(BASE.elasticity);
		expect(next.freeLayout).toBe(BASE.freeLayout);
		expect(next.disabled).toBe(BASE.disabled);
	});

	it("returns a new object instead of mutating the original", () => {
		const next = applyLayoutDensity(BASE, "loose");

		expect(next).not.toBe(BASE);
		expect(BASE.repel).toBe(112);
	});
});

describe("matchLayoutDensity", () => {
	it("recognizes physics produced by each preset", () => {
		for (const density of LAYOUT_DENSITIES) {
			expect(matchLayoutDensity(applyLayoutDensity(BASE, density))).toBe(density);
		}
	});

	it("returns null for hand-tuned physics that matches no preset", () => {
		expect(matchLayoutDensity({ ...BASE, repel: 7, linkDistance: 33, linkStrength: 0.9 })).toBeNull();
	});
});
