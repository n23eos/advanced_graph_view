import { describe, expect, test } from "vitest";
import {
	categoryColor,
	CATEGORY_PALETTE,
	DEFAULT_PRESET_ID,
	resolvePreset,
	sampleGradient,
	SCALE_PRESETS,
} from "./colorScales";

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

	test("uses the scheme palette when one is passed", () => {
		// Arrange
		const palette = SCALE_PRESETS["galaxy"].categories;

		// Act
		const color = categoryColor("projects", palette);

		// Assert
		expect(palette).toContain(color);
	});
});

describe("SCALE_PRESETS", () => {
	test("every scheme carries a gradient and a categorical palette", () => {
		for (const [id, preset] of Object.entries(SCALE_PRESETS)) {
			expect(preset.stops.length, id).toBeGreaterThanOrEqual(2);
			expect(preset.categories.length, id).toBeGreaterThanOrEqual(6);
		}
	});

	test("glow schemes force a dark backdrop so additive blending reads", () => {
		for (const [id, preset] of Object.entries(SCALE_PRESETS)) {
			if (!preset.glow) continue;
			expect(preset.backdrop, id).toBeDefined();
		}
	});
});

describe("resolvePreset", () => {
	test("falls back to the default scheme for unknown ids", () => {
		expect(resolvePreset("nope")).toBe(SCALE_PRESETS[DEFAULT_PRESET_ID]);
	});
});
