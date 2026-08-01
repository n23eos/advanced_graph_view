/**
 * How accurately repulsion is computed, as a function of how hot the layout is.
 *
 * `forceManyBody` is the whole cost of a tick — profiling a 3000-note vault put
 * it at ~99%, with everything else rounding to nothing. Its price is set by the
 * Barnes-Hut `theta`: bigger theta lumps more distant nodes into one
 * approximation and runs faster, smaller theta is exact and slow.
 *
 * The layout was tuned around an accurate 0.6, and that is worth keeping — at
 * rest, coarse repulsion is what makes nodes buzz in place instead of gliding
 * to a stop. But accuracy only matters at rest. While the graph is still hot
 * and nodes are flying across the screen, nobody can see the difference, so
 * those early ticks can run cheap and tighten up as the layout cools.
 *
 * Measured on 3000 notes / 12k links, time to full rest:
 *   3D: 9.1 s → 5.1 s, final radius 198.3 → 198.0 (same shape)
 *   2D: 2.9 s → 1.8 s, final radius unchanged
 * A flat 0.9 settles faster still, but lands on a 5% tighter graph — a
 * visibly different layout, which is the trade this schedule exists to avoid.
 */

/** The tuned value. Everything at rest uses this, so the final shape is unchanged. */
export const SETTLED_THETA = 0.6;
/** Above this alpha the layout is still chaotic; approximate freely. */
const HOT_ALPHA = 0.15;
const HOT_THETA = 1.2;
/** Between the two the layout is recognisable but still moving. */
const WARM_ALPHA = 0.05;
const WARM_THETA = 0.9;

export function repulsionTheta(alpha: number): number {
	if (alpha > HOT_ALPHA) return HOT_THETA;
	if (alpha > WARM_ALPHA) return WARM_THETA;
	return SETTLED_THETA;
}
