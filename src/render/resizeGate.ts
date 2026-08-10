/**
 * Whether a reported host size is worth resizing the canvas for.
 *
 * Two things masquerade as resizes. Sub-pixel deltas are scrollbar overlays
 * and pane-edge hovers — acting on them made the 3D view shudder. A zero size
 * is a hidden tab, not a layout: recentering on it parked the world origin at
 * the top-left pixel, so the graph came back stuck in the corner.
 */

/** Deltas below this are noise, not layout. */
const RESIZE_EPSILON_PX = 2;

export function isMeaningfulResize(
	hostWidth: number,
	hostHeight: number,
	screenWidth: number,
	screenHeight: number
): boolean {
	if (hostWidth <= 0 || hostHeight <= 0) return false;
	return (
		Math.abs(hostWidth - screenWidth) >= RESIZE_EPSILON_PX ||
		Math.abs(hostHeight - screenHeight) >= RESIZE_EPSILON_PX
	);
}
