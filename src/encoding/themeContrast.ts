/**
 * Light-theme readability for the color schemes.
 *
 * Most schemes were tuned against Obsidian's dark background, so their bright
 * end runs to near-white — which disappears on a light theme. Nodes are
 * darkened just enough to stay visible, keeping their hue so the scheme still
 * reads as itself.
 */
import type { ScalePreset } from "./colorScales";

/** Perceived brightness, 0–255. Above this a node is lost on a light canvas. */
const MAX_LIGHT_THEME_LUMINANCE = 150;

export function adaptColorToTheme(color: number, isLightTheme: boolean): number {
	if (!isLightTheme) return color;
	const r = (color >> 16) & 0xff;
	const g = (color >> 8) & 0xff;
	const b = color & 0xff;
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	if (luminance <= MAX_LIGHT_THEME_LUMINANCE) return color;

	// Scaling all three channels by the same factor darkens without shifting
	// hue — a proportional dim, not a blend toward grey.
	const factor = MAX_LIGHT_THEME_LUMINANCE / luminance;
	return (scale(r, factor) << 16) | (scale(g, factor) << 8) | scale(b, factor);
}

function scale(channel: number, factor: number): number {
	return Math.max(0, Math.min(255, Math.round(channel * factor)));
}

/** Same preset on dark themes — identity, so callers can compare by reference.
 *  On light themes a backdrop scheme (galaxy family) loses its forced dark
 *  canvas and its glow — additive blending is invisible on white — and joins
 *  the others: darkened palette on the theme background. */
export function adaptPresetToTheme<T extends ScalePreset>(preset: T, isLightTheme: boolean): T {
	if (!isLightTheme) return preset;
	return {
		...preset,
		glow: undefined,
		backdrop: undefined,
		stops: preset.stops.map((color) => adaptColorToTheme(color, true)),
		categories: preset.categories.map((color) => adaptColorToTheme(color, true)),
	};
}
