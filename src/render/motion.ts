/**
 * Respect the operating system's "reduce motion" setting. The plugin's long
 * camera flights and trail replays are exactly the kind of sustained movement
 * that triggers motion sickness, so they collapse to an instant jump rather
 * than being merely shortened.
 */

/** Duration below which an animation reads as an instant cut. */
const INSTANT_SECONDS = 0.001;

export function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Seconds an animation should run for, given the user's motion preference. */
export function motionSeconds(seconds: number): number {
	return prefersReducedMotion() ? INSTANT_SECONDS : seconds;
}

/** Milliseconds variant, for animations driven by `performance.now()`. */
export function motionMs(ms: number): number {
	return prefersReducedMotion() ? INSTANT_SECONDS * 1000 : ms;
}
