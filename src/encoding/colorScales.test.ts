import { describe, expect, test } from "vitest";
import { categoryColor, CATEGORY_PALETTE, sampleGradient, SCALE_PRESETS } from "./colorScales";

describe("sampleGradient", () => {
	test("returns first stop at 0 and last stop at 1", () => {
		const stops = [0x000000, 0xffffff];
		expect(sampleGradient(stops, 0)).toBe(0x000000);
		expect(sampleGradient(stops, 1)).toBe(0xffffff);
	});

	test("interpolates between stops", () => {
		const mid = sampleGradient([0x000000, 0xffffff], 0.5);
		const r = (mid >> 16) & 0xff;
		expect(r).toBeGreaterThan(100);
		expect(r).toBeLessThan(155);
	});

	test("clamps out-of-range input", () => {
		const stops = [0x112233, 0xaabbcc];
		expect(sampleGradient(stops, -1)).toBe(0x112233);
		expect(sampleGradient(stops, 2)).toBe(0xaabbcc);
	});
});

describe("presets", () => {
	test("recency preset exists with at least 2 stops", () => {
		expect(SCALE_PRESETS["recency"].stops.length).toBeGreaterThanOrEqual(2);
	});
});

describe("categoryColor", () => {
	test("same category always maps to the same color", () => {
		expect(categoryColor("projects")).toBe(categoryColor("projects"));
	});

	test("colors come from the palette", () => {
		expect(CATEGORY_PALETTE).toContain(categoryColor("anything"));
	});
});
