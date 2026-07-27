/**
 * Pure geometry behind node dragging.
 *
 * This lives outside GraphRenderer on purpose: the "does the node track the
 * pointer 1:1" and "does a grab become a drag" rules were tuned across several
 * rounds of fixes, and tuning them by eye inside a Pixi class is how the
 * regressions crept in. Everything here is deterministic and unit-testable.
 */
import type { Camera3D } from "./projection";

/** Pointer must travel this many pixels before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * A press becomes a drag only after the pointer has travelled far enough.
 * Without the dead zone a shaky click would open a note *and* nudge the node.
 */
export function isDragGesture(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	thresholdPx: number = DRAG_THRESHOLD_PX
): boolean {
	return Math.hypot(toX - fromX, toY - fromY) >= thresholdPx;
}

/**
 * A node is only draggable while it is actually on screen and in front of the
 * camera. `project()` reports depthScale 0 for anything past the near plane;
 * dividing a screen delta by that yields Infinity and permanently corrupts the
 * node's position (and, through the layout worker, its neighbours').
 */
export function isDraggableDepth(depthScale: number): boolean {
	return Number.isFinite(depthScale) && depthScale > 1e-4;
}

/** World-space xyz of a node, as consumed by the layout worker. */
export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/**
 * Where the dragged node should sit so that it stays under the pointer.
 *
 * In 3D the node moves inside the screen plane at its own depth — its distance
 * from the camera is preserved, so dragging never yanks a node toward the
 * viewer. In 2D the pointer's world position *is* the answer.
 *
 * Returns `null` when the move must be refused (node behind the camera),
 * leaving the caller's positions untouched rather than poisoning them.
 */
export function dragTargetPosition(options: {
	/** `null` (or a disabled camera) selects the flat path — used in 2D mode and
	 *  whenever no fresh projection is available to drag against. */
	camera: Camera3D | null;
	/** Current world position of the dragged node. */
	current: Vec3;
	/** Pointer position converted to world coordinates by the viewport. */
	pointerWorldX: number;
	pointerWorldY: number;
	/** Current projected screen position of the node (same space as pointer). */
	projectedX: number;
	projectedY: number;
	/** Node's depth scale from the last projection. */
	depthScale: number;
}): Vec3 | null {
	const { camera, current, pointerWorldX, pointerWorldY } = options;

	if (!camera || !camera.enabled) {
		// Flat mode: the world point under the pointer is the target outright.
		return { x: pointerWorldX, y: pointerWorldY, z: current.z };
	}

	if (!isDraggableDepth(options.depthScale)) return null;

	const screenDx = pointerWorldX - options.projectedX;
	const screenDy = pointerWorldY - options.projectedY;
	const [dx, dy, dz] = camera.unprojectDelta(screenDx, screenDy, options.depthScale);

	const next = { x: current.x + dx, y: current.y + dy, z: current.z + dz };
	// unprojectDelta is trigonometry on caller-supplied numbers; one NaN in and
	// the node is gone for the rest of the session. Refuse instead.
	if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.z)) {
		return null;
	}
	return next;
}
