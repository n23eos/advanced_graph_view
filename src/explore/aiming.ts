/**
 * Which link the pointer is aiming down, in explore mode.
 *
 * Hit-testing the drawn line would be the obvious approach and it is the wrong
 * one: a hub with fifty links draws them as one bundle a few pixels wide, and
 * in 3D a distant link is shorter than the cursor. So the pointer picks a
 * *direction* instead — the neighbour whose bearing from the current node is
 * closest to the bearing of the pointer. Same idea as steering towards a star
 * on a galaxy map: you never have to hit anything.
 */

/** Pointer closer than this to the current node targets nothing, so a shaky
 *  hand resting at the center cannot arm a jump. Screen pixels. */
export const DEAD_ZONE_PX = 30;

/** How far off a link's bearing the pointer may sit and still target it.
 *  Wide enough to be forgiving, narrow enough that two links 60° apart are
 *  never ambiguous. */
export const MAX_AIM_ANGLE = (25 * Math.PI) / 180;

/** Bearings within this many radians count as equal, and the tie is settled by
 *  distance instead — this is what makes overlapping links selectable. */
const ANGLE_TIE_EPSILON = 1e-4;

export interface AimOptions {
	/** Projected screen positions, stride 2 — the renderer's own array. */
	positions: Float32Array;
	/** Node the camera is currently sitting on. */
	centerId: number;
	/** Candidate neighbours (node ids linked to `centerId`). */
	neighbors: readonly number[];
	/** Pointer in the same space as `positions`. */
	pointerX: number;
	pointerY: number;
	/** Dead-zone radius in the same units as `positions`. */
	deadZone: number;
	/** Angular tolerance in radians. */
	maxAngle: number;
	/** 1 = node is filtered out, so it cannot be a destination. */
	hiddenMask?: Uint8Array | null;
	/** Per-node depth scale; 0 = behind the camera, position is stale. */
	depthScales?: Float32Array | null;
}

/** Smallest absolute difference between two bearings, in [0, π]. */
function angleBetween(a: number, b: number): number {
	let delta = Math.abs(a - b) % (Math.PI * 2);
	if (delta > Math.PI) delta = Math.PI * 2 - delta;
	return delta;
}

/**
 * The neighbour the pointer is aiming at, or `null` when it is aiming at
 * nothing (inside the dead zone, or off every link by more than `maxAngle`).
 */
export function pickAimedNeighbor(options: AimOptions): number | null {
	const { positions, centerId, neighbors, pointerX, pointerY, hiddenMask, depthScales } = options;

	const centerX = positions[centerId * 2];
	const centerY = positions[centerId * 2 + 1];

	const pointerDx = pointerX - centerX;
	const pointerDy = pointerY - centerY;
	const pointerDistance = Math.hypot(pointerDx, pointerDy);
	if (pointerDistance < options.deadZone) return null;

	const pointerAngle = Math.atan2(pointerDy, pointerDx);

	let best: number | null = null;
	let bestAngle = Infinity;
	let bestDistanceError = Infinity;

	for (const id of neighbors) {
		if (id === centerId) continue;
		if (hiddenMask != null && hiddenMask[id] === 1) continue;
		if (depthScales != null && depthScales[id] === 0) continue;

		const dx = positions[id * 2] - centerX;
		const dy = positions[id * 2 + 1] - centerY;
		const distance = Math.hypot(dx, dy);
		// A neighbour drawn on top of the center has no bearing to aim down.
		if (distance === 0) continue;

		const delta = angleBetween(Math.atan2(dy, dx), pointerAngle);
		if (delta > options.maxAngle) continue;

		const distanceError = Math.abs(distance - pointerDistance);
		const tied = Math.abs(delta - bestAngle) <= ANGLE_TIE_EPSILON;
		const better = tied ? distanceError < bestDistanceError : delta < bestAngle;
		if (!better) continue;

		best = id;
		bestAngle = delta;
		bestDistanceError = distanceError;
	}

	return best;
}
