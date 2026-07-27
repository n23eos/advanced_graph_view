/**
 * Which node is under the pointer.
 *
 * Pulled out of GraphRenderer because picking the wrong node is invisible in a
 * screenshot and only shows up as "clicking opened the wrong note" — exactly
 * the sort of rule that wants tests rather than eyeballing.
 */

/** Pointer forgiveness: a click within this many screen pixels of a node's
 *  center still counts, so tiny nodes stay clickable. */
export const HOVER_RADIUS_PX = 12;

export interface PickOptions {
	/** Projected screen positions, stride 2. */
	positions: Float32Array;
	/** Screen-space radius per node. */
	radii: Float32Array;
	/** Pointer position in the same space as `positions`. */
	pointerX: number;
	pointerY: number;
	/** Click forgiveness in world units (screen px ÷ viewport scale). */
	hitRadius: number;
	/** 1 = node is filtered out and must not be pickable. */
	hiddenMask?: Uint8Array | null;
	/** Per-node depth scale; 0 = behind the camera, so not pickable. */
	depthScales?: Float32Array | null;
}

/**
 * Nearest node whose visual disc contains the pointer, or `null`.
 *
 * "Visual" is the point: in 3D a node's clickable disc is its radius times its
 * depth scale, so a distant node does not swallow clicks meant for the near
 * node drawn on top of it.
 */
export function pickNodeAt(options: PickOptions): number | null {
	const { positions, radii, pointerX, pointerY, hitRadius, hiddenMask, depthScales } = options;

	let best: number | null = null;
	let bestDistance = Infinity;

	for (let i = 0; i < radii.length; i++) {
		if (hiddenMask != null && hiddenMask[i] === 1) continue;
		if (depthScales != null && depthScales[i] === 0) continue;

		const dx = positions[i * 2] - pointerX;
		const dy = positions[i * 2 + 1] - pointerY;
		const distance = Math.hypot(dx, dy);
		const visualRadius = radii[i] * (depthScales ? depthScales[i] : 1);

		if (distance <= Math.max(visualRadius, hitRadius) && distance < bestDistance) {
			best = i;
			bestDistance = distance;
		}
	}

	return best;
}
