import { describe, expect, it } from "vitest";
import {
	ADAPT_REFERENCE_NODES,
	LAYOUT_DENSITIES,
	adaptPhysicsToGraphSize,
	applyLayoutDensity,
	matchLayoutDensity,
} from "./layoutDensity";
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

describe("adaptPhysicsToGraphSize", () => {
	it("leaves physics untouched at the reference vault size", () => {
		const next = adaptPhysicsToGraphSize(BASE, ADAPT_REFERENCE_NODES);

		expect(next.repel).toBe(BASE.repel);
		expect(next.linkDistance).toBe(BASE.linkDistance);
	});

	it("pulls a big vault tighter so it does not fly apart", () => {
		const next = adaptPhysicsToGraphSize(BASE, ADAPT_REFERENCE_NODES * 16);

		expect(next.repel).toBeLessThan(BASE.repel);
		expect(next.linkDistance).toBeLessThan(BASE.linkDistance);
	});

	it("spreads a tiny vault out so it does not clump into a dot", () => {
		const next = adaptPhysicsToGraphSize(BASE, 10);

		expect(next.repel).toBeGreaterThan(BASE.repel);
		expect(next.linkDistance).toBeGreaterThan(BASE.linkDistance);
	});

	it("clamps the adjustment so extreme vaults stay usable", () => {
		const huge = adaptPhysicsToGraphSize(BASE, 1_000_000);
		const tiny = adaptPhysicsToGraphSize(BASE, 1);

		expect(huge.linkDistance).toBeGreaterThan(0);
		expect(tiny.linkDistance / BASE.linkDistance).toBeLessThanOrEqual(1.5);
		expect(huge.linkDistance / BASE.linkDistance).toBeGreaterThanOrEqual(0.5);
	});

	it("touches only repel and linkDistance, and never mutates the input", () => {
		const next = adaptPhysicsToGraphSize(BASE, ADAPT_REFERENCE_NODES * 4);

		expect(next).not.toBe(BASE);
		expect(next.linkStrength).toBe(BASE.linkStrength);
		expect(next.centering).toBe(BASE.centering);
		expect(next.velocityDecay).toBe(BASE.velocityDecay);
		expect(next.freeLayout).toBe(BASE.freeLayout);
		expect(BASE.repel).toBe(112);
	});

	it("treats an empty graph as neutral instead of dividing by zero", () => {
		const next = adaptPhysicsToGraphSize(BASE, 0);

		expect(next.repel).toBe(BASE.repel);
		expect(next.linkDistance).toBe(BASE.linkDistance);
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
