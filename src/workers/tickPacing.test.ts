import { describe, expect, test } from "vitest";
import { MIN_TICK_GAP_MS, nextTickDelay } from "./tickPacing";

describe("nextTickDelay", () => {
	test("a cheap tick waits out the rest of the frame budget", () => {
		// Arrange: 33 ms target, tick took 20 ms

		// Act
		const delay = nextTickDelay(33, 20);

		// Assert: 13 ms left, so the next tick lands on the 33 ms beat
		expect(delay).toBe(13);
	});

	test("an instant tick waits the whole interval", () => {
		expect(nextTickDelay(33, 0)).toBe(33);
	});

	test("a tick that overruns its budget still yields to the message queue", () => {
		// A 3D tick on a 3000-note vault costs ~66 ms against a 33 ms budget.
		// Naive scheduling would run the next tick immediately and starve
		// incoming drag/params messages, which is what makes dragging a big
		// graph feel unresponsive.

		// Act
		const delay = nextTickDelay(33, 66);

		// Assert
		expect(delay).toBe(MIN_TICK_GAP_MS);
	});

	test("never returns a negative or zero delay", () => {
		for (const cost of [0, 1, 33, 100, 5000]) {
			expect(nextTickDelay(33, cost)).toBeGreaterThan(0);
		}
	});

	test("an unmeasured first tick falls back to the full interval", () => {
		expect(nextTickDelay(33, null)).toBe(33);
	});

	test("respects a shorter interval, as used while dragging", () => {
		// Dragging runs at 16 ms so the grabbed node keeps up with the pointer.
		expect(nextTickDelay(16, 5)).toBe(11);
		expect(nextTickDelay(16, 40)).toBe(MIN_TICK_GAP_MS);
	});
});
