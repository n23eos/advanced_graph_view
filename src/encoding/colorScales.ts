/**
 * Color schemes for node encoding. Each scheme carries both a gradient (for
 * numeric metrics) and a categorical palette (for folders/tags/clusters), so
 * switching the scheme recolors the whole graph consistently.
 */

export interface ScalePreset {
	label: string;
	/** Gradient stops for numeric color metrics. */
	stops: number[];
	/** Distinct hues for categorical color metrics. */
	categories: number[];
	/** Additive blending: nodes glow like stars where they overlap. */
	glow?: boolean;
	/** Forced canvas background; omitted schemes keep the Obsidian theme. */
	backdrop?: number;
}

/** Default categorical hues — 12 well-separated pastel-ish colors. */
export const CATEGORY_PALETTE: number[] = [
	0x63b3ed, 0xf6ad55, 0x68d391, 0xfc8181, 0xb794f4, 0xf6e05e,
	0x4fd1c5, 0xf687b3, 0xa0aec0, 0xd6bcfa, 0x9ae6b4, 0xfbd38d,
];

/** Value 0 → first stop (cold/low), value 1 → last stop (hot/high). */
export const SCALE_PRESETS: Record<string, ScalePreset> = {
	// Default: cooled slate blue → warm amber.
	recency: {
		label: "Amber → steel",
		stops: [0x4a5568, 0x718096, 0xd69e2e, 0xf6ad55],
		categories: CATEGORY_PALETTE,
	},
	heat: {
		label: "Fire",
		stops: [0x2c5282, 0x805ad5, 0xe53e3e, 0xf6e05e],
		categories: [
			0xe53e3e, 0xed8936, 0xf6e05e, 0x805ad5, 0xd53f8c, 0xdd6b20,
			0xf56565, 0xb794f4, 0xfbd38d, 0x9f7aea, 0xfc8181, 0xecc94b,
		],
	},
	mono: {
		label: "Mono",
		stops: [0x4a5568, 0xe2e8f0],
		categories: [
			0x2d3748, 0x4a5568, 0x718096, 0xa0aec0, 0xcbd5e0, 0xe2e8f0,
			0x1a202c, 0x3c4759, 0x5f6b7d, 0x8e9aab, 0xbcc4cf, 0xf7fafc,
		],
	},
	galaxy: {
		label: "Galaxy ✨",
		stops: [0x1a1a4e, 0x4c1d95, 0x7c3aed, 0x22d3ee, 0xf8fafc],
		categories: [
			0x7c3aed, 0x22d3ee, 0xf472b6, 0x38bdf8, 0xa78bfa, 0x5eead4,
			0xfb7185, 0x818cf8, 0x67e8f9, 0xc084fc, 0xf0abfc, 0xfde047,
		],
		glow: true,
		backdrop: 0x05050f,
	},
	nebula: {
		label: "Nebula ✨",
		stops: [0x0b1026, 0x7c2d92, 0xdb2777, 0xfb923c, 0xfef3c7],
		categories: [
			0xdb2777, 0xfb923c, 0x8b5cf6, 0x06b6d4, 0xf59e0b, 0xec4899,
			0x3b82f6, 0xa855f7, 0xf97316, 0x14b8a6, 0xef4444, 0xfacc15,
		],
		glow: true,
		backdrop: 0x0a0618,
	},
	neon: {
		label: "Neon ✨",
		stops: [0x0f172a, 0x0891b2, 0x22d3ee, 0x4ade80, 0xfafafa],
		categories: [
			0x22d3ee, 0x4ade80, 0xf0abfc, 0xfacc15, 0xfb7185, 0x60a5fa,
			0x34d399, 0xe879f9, 0xfbbf24, 0x38bdf8, 0xa3e635, 0xff8fab,
		],
		glow: true,
		backdrop: 0x060a14,
	},
	solar: {
		label: "Solar",
		stops: [0x1e3a8a, 0x0891b2, 0xfbbf24, 0xfef08a],
		categories: [
			0xfbbf24, 0x0891b2, 0xf97316, 0x1e3a8a, 0xfde047, 0x0ea5e9,
			0xea580c, 0x3b82f6, 0xfacc15, 0x06b6d4, 0xd97706, 0x93c5fd,
		],
	},
	pastel: {
		label: "Pastel",
		stops: [0xbfdbfe, 0xc7d2fe, 0xfbcfe8, 0xfed7aa],
		categories: [
			0xa5b4fc, 0xfbcfe8, 0xa7f3d0, 0xfecaca, 0xddd6fe, 0xfef08a,
			0x99f6e4, 0xf5d0fe, 0xbfdbfe, 0xfed7aa, 0xd9f99d, 0xfbcfe8,
		],
	},
};

export const DEFAULT_PRESET_ID = "recency";

export function resolvePreset(presetId: string): ScalePreset {
	return SCALE_PRESETS[presetId] ?? SCALE_PRESETS[DEFAULT_PRESET_ID];
}

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
export function categoryColor(category: string, palette: readonly number[] = CATEGORY_PALETTE): number {
	let hash = 5381;
	for (let i = 0; i < category.length; i++) {
		hash = ((hash << 5) + hash + category.charCodeAt(i)) | 0;
	}
	return palette[Math.abs(hash) % palette.length];
}
