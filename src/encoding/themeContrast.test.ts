import { describe, expect, test } from "vitest";
import { adaptColorToTheme, adaptPresetToTheme } from "./themeContrast";

describe("adaptColorToTheme", () => {
	test("leaves colors alone on a dark theme", () => {
		expect(adaptColorToTheme(0xe2e8f0, false)).toBe(0xe2e8f0);
	});

	test("darkens near-white colors that would vanish on a light background", () => {
		const adapted = adaptColorToTheme(0xf7fafc, true);

		expect(adapted).not.toBe(0xf7fafc);
		expect(luminance(adapted)).toBeLessThan(luminance(0xf7fafc));
	});

	test("leaves colors that already read on white untouched", () => {
		expect(adaptColorToTheme(0x2d3748, true)).toBe(0x2d3748);
	});

	test("keeps the hue when it darkens", () => {
		const adapted = adaptColorToTheme(0xfde047, true); // pale yellow
		const [r, g, b] = channels(adapted);

		expect(r).toBeGreaterThan(b);
		expect(g).toBeGreaterThan(b);
	});
});

describe("adaptPresetToTheme", () => {
	const preset = { stops: [0x4a5568, 0xf7fafc], categories: [0xffffff, 0x2d3748] };

	test("returns the same preset object on a dark theme", () => {
		expect(adaptPresetToTheme(preset, false)).toBe(preset);
	});

	test("adapts both stops and categories on a light theme", () => {
		const adapted = adaptPresetToTheme(preset, true);

		expect(luminance(adapted.stops[1])).toBeLessThan(luminance(preset.stops[1]));
		expect(luminance(adapted.categories[0])).toBeLessThan(luminance(preset.categories[0]));
		expect(adapted.categories[1]).toBe(preset.categories[1]);
	});

	test("leaves schemes that bring their own dark backdrop alone", () => {
		const galaxy = { stops: [0xf8fafc], categories: [0xffffff], glow: true, backdrop: 0x05050f };

		expect(adaptPresetToTheme(galaxy, true)).toBe(galaxy);
	});
});

function channels(color: number): [number, number, number] {
	return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function luminance(color: number): number {
	const [r, g, b] = channels(color);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
