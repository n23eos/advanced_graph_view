/**
 * Bridges the gap between the layout worker's 30 Hz frames and the 60 fps
 * render loop. Without it every node teleports to its new spot twice per three
 * rendered frames, which reads as stepping and as a hard stop the moment the
 * simulation cools — the motion the eye expects to see decaying is simply
 * missing between ticks.
 */

/** Fraction of the remaining gap closed per rendered frame. High enough that
 *  the graph never feels laggy behind the physics, low enough to hide the
 *  30 Hz staircase. */
export const SMOOTH_FACTOR = 0.35;

/** World-unit gap below which a node is snapped onto its target. Ends the
 *  asymptote so a settled graph stops re-projecting and costs nothing. */
export const SMOOTH_SNAP_EPSILON = 0.05;

/**
 * Eases `current` one rendered frame's worth toward `target`, in place.
 *
 * Mutation is deliberate here: this runs over every node on every frame, and
 * the rest of the render pipeline (`camera.project`, `EdgeMesh.updatePositions`)
 * already reuses its typed arrays rather than allocating per frame.
 *
 * @returns true while at least one coordinate is still short of its target.
 */
export function easePositions(
	current: Float32Array,
	target: Float32Array,
	factor: number
): boolean {
	if (current.length !== target.length) return false;
	let moving = false;
	for (let i = 0; i < current.length; i++) {
		const gap = target[i] - current[i];
		if (gap > -SMOOTH_SNAP_EPSILON && gap < SMOOTH_SNAP_EPSILON) {
			current[i] = target[i];
			continue;
		}
		current[i] += gap * factor;
		moving = true;
	}
	return moving;
}
