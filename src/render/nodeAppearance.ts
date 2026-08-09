/**
 * Per-node size and opacity math for one frame.
 *
 * These rules accumulated one tweak at a time — a fog floor so far nodes do not
 * go black, a size floor so they do not become specks, a near fade so nodes
 * streaking past the camera dissolve instead of popping, hover and highlight
 * boosts on top. Kept here as pure functions so each rule can be stated once
 * and checked, instead of being re-derived from a loop body in GraphRenderer.
 */

/** Far nodes stop shrinking below this share of their base size. */
export const MIN_SIZE_DEPTH = 0.5;
/** Far nodes never fade below this alpha. */
export const FOG_FLOOR = 0.55;
/** Hover emphasis: the sprite grows and lifts above the crowd. */
export const HOVER_SIZE_BOOST = 1.9;
/** Search/overlay matches grow a little so they read at a glance. */
export const HIGHLIGHT_SIZE_BOOST = 1.45;
/** Neighbours of the hovered node stay lit at least this much. */
export const HOVER_NEIGHBOR_ALPHA = 0.9;
/** Alpha of nodes excluded by a filter. */
export const DIM_ALPHA = 0.12;
/** Nodes dissolve over the last stretch before the near plane (world units). */
const NEAR_FADE_START = 40;
const NEAR_FADE_LENGTH = 200;
/** World-unit clearance between a pinned node's sprite and its ring. */
export const PIN_RING_GAP = 3;
/** In 2D a node never renders smaller than this on screen (px). */
export const MIN_NODE_SCREEN_PX = 2.5;

/**
 * Size multiplier keeping a 2D node's screen diameter at MIN_NODE_SCREEN_PX
 * when zooming out would shrink it below that — dots stay dots, not dust.
 * Returns 1 (no compensation) for degenerate inputs.
 */
export function zoomSizeCompensation(worldDiameter: number, viewScale: number): number {
	const screenDiameter = worldDiameter * viewScale;
	if (screenDiameter <= 0 || screenDiameter >= MIN_NODE_SCREEN_PX) return 1;
	return MIN_NODE_SCREEN_PX / screenDiameter;
}

/**
 * Radius of the ring marking a pinned node. Tracks the sprite it wraps: the
 * same depth scaling the sprite gets, the same glow-scheme size factor, plus a
 * fixed gap so the ring reads as an outline rather than a halo.
 */
export function pinRingRadius(baseRadius: number, depth: number, spriteScale: number): number {
	return baseRadius * sizeDepth(depth) * spriteScale + PIN_RING_GAP;
}

/**
 * Depth clamped for sizing. Nodes behind the camera keep depth 0 so they stay
 * hidden; everything else is floored so distance never renders a node as dust.
 */
export function sizeDepth(depth: number): number {
	return depth <= 0 ? 0 : Math.max(depth, MIN_SIZE_DEPTH);
}

/**
 * Distance haze for one node, combining two fades:
 * far nodes dim toward FOG_FLOOR, and nodes about to cross the near plane fade
 * to zero so they dissolve rather than pop out of existence.
 */
export function fogFactor(depth: number, focal: number): number {
	let fog = Math.min(1, Math.max(FOG_FLOOR, (depth - 0.2) * 1.3));
	if (depth > 1) {
		const distance = focal / depth;
		fog *= Math.min(1, Math.max(0, (distance - NEAR_FADE_START) / NEAR_FADE_LENGTH));
	}
	return fog;
}

/** How much bigger a sprite is drawn because of hover / search highlight. */
export function emphasisBoost(isHovered: boolean, isHighlighted: boolean): number {
	if (isHovered) return HOVER_SIZE_BOOST;
	if (isHighlighted) return HIGHLIGHT_SIZE_BOOST;
	return 1;
}

export interface NodeAlphaInput {
	/** Encoded glow/intensity for the node, 0..1. */
	glow: number;
	/** Excluded by the active filter. */
	dimmed: boolean;
	/** Extra per-node alpha multiplier (focus-mode distance fade). */
	factor: number;
	/** Distance haze, from `fogFactor`. */
	fog: number;
	/** Something is hovered right now. */
	hoverActive: boolean;
	isHovered: boolean;
	isHoverNeighbor: boolean;
}

/**
 * Final sprite alpha. Hovering lifts the node and its neighbours without
 * dimming the rest of the scene — whole-scene dimming made every hover flash
 * the entire graph.
 */
export function nodeAlpha(input: NodeAlphaInput): number {
	const base = input.dimmed ? input.glow * DIM_ALPHA : input.glow;
	let alpha = base * input.factor * input.fog;
	if (input.hoverActive) {
		if (input.isHovered) alpha = 1;
		else if (input.isHoverNeighbor) alpha = Math.max(alpha, HOVER_NEIGHBOR_ALPHA);
	}
	return alpha;
}

/**
 * Nodes whose edges must not be drawn: user-hidden ones plus anything behind
 * the camera. Without the second half, a clipped endpoint projects to the
 * origin and drags a line across the middle of the screen.
 *
 * Writes into `out` (reused across frames) and returns it, or returns
 * `hiddenMask` unchanged when there is no depth information to fold in.
 */
export function mergeHiddenMask(
	hiddenMask: Uint8Array | null,
	depthScales: Float32Array | null,
	out: Uint8Array | null
): { mask: Uint8Array | null; buffer: Uint8Array | null } {
	if (!depthScales) return { mask: hiddenMask, buffer: out };

	const buffer =
		out && out.length === depthScales.length ? out : new Uint8Array(depthScales.length);
	for (let i = 0; i < buffer.length; i++) {
		buffer[i] = (hiddenMask !== null && hiddenMask[i] === 1) || depthScales[i] === 0 ? 1 : 0;
	}
	return { mask: buffer, buffer };
}

/**
 * Label opacity from camera depth in 3D: a name on a note in front of the
 * projection plane reads at full strength, and fades continuously the deeper
 * the note sits — distance is told by how legible the name is. The floor
 * stays barely above zero so a label never vanishes while its node is drawn.
 */
export function labelDepthAlpha(depth: number): number {
	return Math.min(1, Math.max(0.03, (depth - 0.3) * 1.15));
}
