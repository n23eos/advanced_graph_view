/**
 * Moving the camera from one node to the next.
 *
 * The angle never changes during a hop — only the position does. Turning and
 * travelling at the same time is what makes a graph fly-through nauseating,
 * and holding the angle also means the graph keeps the same orientation from
 * node to node, so you can still tell where you came from.
 */

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/** Standing distance from a node, when there is nothing better to go on. */
export const DEFAULT_EXPLORE_DISTANCE = 180;

/** A node whose links sit almost on top of it still needs standing room. */
export const MIN_EXPLORE_DISTANCE = 90;

/** Standing back this many times the neighbourhood's own radius. Barely more
 *  than 1: far enough that every link stays in front of the camera, close
 *  enough that the notes are big and their names readable. */
const NEIGHBORHOOD_STANDOFF = 1.15;

/**
 * How far back to stand so a node's neighbours sit in the view — proportional
 * to how far they sprawl, because vaults differ and a constant leaves a tight
 * cluster a smudge and a hub off-screen.
 *
 * Deliberately NOT solved backwards from a wanted size on screen: this
 * projection cannot magnify beyond 1×, so demanding a size larger than the
 * neighbourhood's own world extent drives the answer negative, and clamping
 * that lands the camera *inside* the cloud — where the nodes right in front of
 * the lens swell over the whole screen and the graph reads as one blob.
 *
 * No upper bound either, for the same reason from the other side: a cap that
 * landed below the neighbourhood's own extent would put links behind the
 * camera. A sprawling neighbourhood is simply watched from further away.
 */
export function framingDistance(spread: number): number {
	if (!Number.isFinite(spread) || spread <= 0) return DEFAULT_EXPLORE_DISTANCE;
	return Math.max(MIN_EXPLORE_DISTANCE, spread * NEIGHBORHOOD_STANDOFF);
}

/**
 * How far the camera is standing right now — the distance a hop must keep.
 *
 * Framing is for arriving somewhere new, not for travelling: once the mode is
 * running, a hop moves *what* the camera looks at and nothing else. Re-framing
 * per node would rescale the picture under a pointer that never asked for it,
 * and the zoom the user set with the wheel would not survive the trip.
 */
export function keptDistance(cameraPosition: Vec3, nodePosition: Vec3 | null): number {
	if (!nodePosition) return DEFAULT_EXPLORE_DISTANCE;

	const distance = Math.hypot(
		cameraPosition.x - nodePosition.x,
		cameraPosition.y - nodePosition.y,
		cameraPosition.z - nodePosition.z
	);
	if (!Number.isFinite(distance) || distance <= 0) return DEFAULT_EXPLORE_DISTANCE;
	return Math.max(MIN_EXPLORE_DISTANCE, distance);
}

/**
 * Where the camera stands to look at `target` from `forward`, `distance` away.
 * `forward` is the camera's unit look axis (`Camera3D.forward()`).
 */
export function viewpointFor(
	target: Vec3,
	forward: readonly [number, number, number],
	distance: number
): Vec3 {
	return {
		x: target.x - forward[0] * distance,
		y: target.y - forward[1] * distance,
		z: target.z - forward[2] * distance,
	};
}

/** Slow at both ends, quick through the middle. */
export function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Camera position `progress` of the way from `from` to `to`. Progress outside
 * 0..1 is clamped, so a long frame cannot fling the camera past the node.
 */
export function flightPosition(from: Vec3, to: Vec3, progress: number): Vec3 {
	if (progress <= 0) return { ...from };
	if (progress >= 1) return { ...to };

	const t = easeInOutCubic(progress);
	return {
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t,
		z: from.z + (to.z - from.z) * t,
	};
}
