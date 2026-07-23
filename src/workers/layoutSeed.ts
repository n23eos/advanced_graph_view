/**
 * Starting positions for the force layout in a chosen shape. The engine still
 * relaxes these with physics, so the shape is a seed the graph grows out of —
 * a circle or grid loosens into an organic layout, a scatter avoids the
 * fractal spiral d3-force falls into when nodes start with no position.
 */

export type LayoutShape = "force" | "circle" | "grid" | "scatter" | "free";

/** World-space distance between neighbours in the seed arrangements. */
const SPACING = 40;

/** Deterministic [0,1) hash of an integer — a scatter with no visible pattern,
 *  unlike the phyllotaxis spiral a radial formula would produce. */
function hash01(n: number): number {
	let h = n | 0;
	h = (h ^ 61) ^ (h >>> 16);
	h = h + (h << 3);
	h = h ^ (h >>> 4);
	h = Math.imul(h, 0x27d4eb2d);
	h = h ^ (h >>> 15);
	return (h >>> 0) / 4294967296;
}

/** xyz seed positions (stride 3, z = 0) for `count` nodes in the given shape. */
export function computeLayoutSeed(shape: LayoutShape, count: number): Float32Array {
	const seed = new Float32Array(count * 3);
	if (count === 0) return seed;

	if (shape === "circle") {
		// A FILLED disc, not a ring: r = R·√u spreads points evenly over the
		// area, and a random angle avoids any visible spiral.
		const radius = SPACING * Math.sqrt(count / Math.PI);
		for (let i = 0; i < count; i++) {
			const r = radius * Math.sqrt(hash01(i * 2 + 1));
			const angle = hash01(i * 2 + 2) * 2 * Math.PI;
			seed[i * 3] = Math.cos(angle) * r;
			seed[i * 3 + 1] = Math.sin(angle) * r;
		}
		return seed;
	}

	if (shape === "grid") {
		const cols = Math.ceil(Math.sqrt(count));
		const rows = Math.ceil(count / cols);
		for (let i = 0; i < count; i++) {
			const col = i % cols;
			const row = Math.floor(i / cols);
			seed[i * 3] = (col - (cols - 1) / 2) * SPACING;
			seed[i * 3 + 1] = (row - (rows - 1) / 2) * SPACING;
		}
		return seed;
	}

	// "force" / "scatter" / "free": a uniform square cloud, density kept even.
	const extent = SPACING * Math.sqrt(count);
	for (let i = 0; i < count; i++) {
		seed[i * 3] = (hash01(i * 2 + 1) - 0.5) * extent;
		seed[i * 3 + 1] = (hash01(i * 2 + 2) - 0.5) * extent;
	}
	return seed;
}
