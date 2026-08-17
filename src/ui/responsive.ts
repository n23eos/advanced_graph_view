/**
 * F-04: the floating UI adapts to the VIEW's width (Obsidian panes resize
 * without the window changing), reported by a ResizeObserver on the container.
 */
export type ResponsiveMode = "full" | "compact" | "minimal";

export const FULL_MIN_WIDTH = 900;
export const COMPACT_MIN_WIDTH = 600;

export function responsiveMode(width: number): ResponsiveMode {
	if (width >= FULL_MIN_WIDTH) return "full";
	if (width >= COMPACT_MIN_WIDTH) return "compact";
	return "minimal";
}
