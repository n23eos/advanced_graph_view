/**
 * How long to wait before the next simulation tick.
 *
 * `setInterval` was the wrong tool: it assumes the handler finishes well inside
 * the interval. A 3D tick on a 3000-note vault costs ~66 ms against a 33 ms
 * budget, so the timer fires the moment the previous tick returns and the
 * worker never gets back to its message loop — drag and parameter changes queue
 * up behind physics. Pacing each tick individually keeps the worker responsive
 * whatever the graph costs.
 */

/**
 * Floor on the gap between ticks. Small enough not to slow a healthy layout,
 * large enough that the worker always returns to its event loop and drains
 * pending messages before starting the next tick.
 */
export const MIN_TICK_GAP_MS = 8;

/**
 * @param intervalMs Target period between ticks.
 * @param lastTickMs What the previous tick actually cost, or `null` before the
 *                   first measurement.
 */
export function nextTickDelay(intervalMs: number, lastTickMs: number | null): number {
	if (lastTickMs === null) return intervalMs;
	// Spend only the leftover of the budget, so a cheap tick still lands on the
	// intended beat instead of drifting late by its own duration.
	return Math.max(MIN_TICK_GAP_MS, intervalMs - lastTickMs);
}
