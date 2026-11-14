import { afterEach, describe, expect, test, vi } from "vitest";
import { INSTANT_SECONDS, motionMs, motionSeconds, prefersReducedMotion } from "./motion";

afterEach(() => vi.unstubAllGlobals());

describe("motion preference", () => {
	test("keeps ordinary flight and replay durations", () => {
		const matchMedia = vi.fn(() => ({ matches: false }));
		vi.stubGlobal("window", { matchMedia });

		expect(prefersReducedMotion()).toBe(false);
		expect(motionSeconds(0.6)).toBe(0.6);
		expect(motionMs(4000)).toBe(4000);
		expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
	});

	test("uses the shared positive instant duration when reduced motion is enabled", () => {
		vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });

		expect(prefersReducedMotion()).toBe(true);
		expect(INSTANT_SECONDS).toBeGreaterThan(0);
		expect(motionSeconds(0.6)).toBe(INSTANT_SECONDS);
		expect(motionMs(4000)).toBe(INSTANT_SECONDS * 1000);
	});
});
