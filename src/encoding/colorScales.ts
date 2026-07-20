/**
 * Color scales for node encoding. Gradients are stop lists sampled at
 * a normalized 0..1 value; categorical values hash into a fixed palette.
 */

export interface ScalePreset {
	label: string;
	stops: number[];
}

/** Value 0 → first stop (cold/low), value 1 → last stop (hot/high). */
export const SCALE_PRESETS: Record<string, ScalePreset> = {
	// Default: cooled slate blue → warm amber.
	recency: { label: "Amber → steel", stops: [0x4a5568, 0x718096, 0xd69e2e, 0xf6ad55] },
	heat: { label: "Fire", stops: [0x2c5282, 0x805ad5, 0xe53e3e, 0xf6e05e] },
	mono: { label: "Mono", stops: [0x4a5568, 0xe2e8f0] },
};

/** 12 hues spread for categorical coloring (folders, tags, clusters later). */
export const CATEGORY_PALETTE: number[] = [
	0x63b3ed, 0xf6ad55, 0x68d391, 0xfc8181, 0xb794f4, 0xf6e05e,
	0x4fd1c5, 0xf687b3, 0xa0aec0, 0xd6bcfa, 0x9ae6b4, 0xfbd38d,
];

export function sampleGradient(stops: readonly number[], value: number): number {
	const clamped = Math.min(1, Math.max(0, value));
	if (stops.length === 1) return stops[0];
	const scaled = clamped * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(scaled));
	const t = scaled - index;
	return lerpColor(stops[index], stops[index + 1], t);
}

function lerpColor(a: number, b: number, t: number): number {
	const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
	const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
	const r = Math.round(ar + (br - ar) * t);
	const g = Math.round(ag + (bg - ag) * t);
	const bl = Math.round(ab + (bb - ab) * t);
	return (r << 16) | (g << 8) | bl;
}

/** Stable string hash → palette slot, so category colors survive restarts. */
export function categoryColor(category: string): number {
	let hash = 5381;
	for (let i = 0; i < category.length; i++) {
		hash = ((hash << 5) + hash + category.charCodeAt(i)) | 0;
	}
	return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
}
