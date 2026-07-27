import { describe, expect, test } from "vitest";
import {
	DEFAULT_TUNING,
	NO_INPUT,
	PilotController,
	type PilotInput,
} from "./PilotController";

const FRAME = 1 / 60;
const FORWARD: PilotInput = { forward: 1, right: 0, up: 0 };
const DIAGONAL: PilotInput = { forward: 1, right: 1, up: 0 };

/**
 * Fly for `seconds` of simulated time and report distance travelled.
 *
 * The step count is derived up front rather than accumulating `t += dt`:
 * floating-point drift there silently changes the total flight time between
 * frame rates, which would make the frame-rate tests below compare unequal
 * journeys and blame the flight model for it.
 */
function fly(
	pilot: PilotController,
	seconds: number,
	dt: number,
	input: PilotInput = NO_INPUT,
	boosting = false
) {
	const travelled = { forward: 0, right: 0, up: 0 };
	const steps = Math.round(seconds / dt);
	for (let i = 0; i < steps; i++) {
		const step = pilot.update(dt, input, boosting);
		travelled.forward += step.forward;
		travelled.right += step.right;
		travelled.up += step.up;
	}
	return travelled;
}

/** Fly at a steady 60 fps. */
function hold(
	pilot: PilotController,
	seconds: number,
	input: PilotInput = NO_INPUT,
	boosting = false
) {
	return fly(pilot, seconds, FRAME, input, boosting);
}

describe("starting up", () => {
	test("a fresh pilot is at rest", () => {
		expect(new PilotController().speed).toBe(0);
	});

	test("an idle frame moves nothing", () => {
		const pilot = new PilotController();
		expect(pilot.update(FRAME)).toEqual({ forward: 0, right: 0, up: 0 });
	});

	test("holding forward builds speed rather than jumping to it", () => {
		const pilot = new PilotController();

		const first = pilot.update(FRAME, FORWARD).forward;
		const second = pilot.update(FRAME, FORWARD).forward;

		expect(first).toBeGreaterThan(0);
		expect(second).toBeGreaterThan(first);
		expect(first).toBeLessThan(DEFAULT_TUNING.maxSpeed * FRAME);
	});

	test("each axis moves the way its key says", () => {
		const back = hold(new PilotController(), 0.2, { forward: -1, right: 0, up: 0 });
		const left = hold(new PilotController(), 0.2, { forward: 0, right: -1, up: 0 });
		const up = hold(new PilotController(), 0.2, { forward: 0, right: 0, up: 1 });

		expect(back.forward).toBeLessThan(0);
		expect(left.right).toBeLessThan(0);
		expect(up.up).toBeGreaterThan(0);
	});
});

describe("speed limits", () => {
	test("speed never passes the ceiling, however long you hold", () => {
		const pilot = new PilotController();
		hold(pilot, 30, FORWARD);
		expect(pilot.speed).toBeLessThanOrEqual(DEFAULT_TUNING.maxSpeed + 1e-6);
	});

	test("a diagonal is not faster than a straight line", () => {
		// The classic strafe-running bug: W+D outrunning W.
		const straight = new PilotController();
		const diagonal = new PilotController();
		hold(straight, 5, FORWARD);
		hold(diagonal, 5, DIAGONAL);

		expect(diagonal.speed).toBeLessThanOrEqual(straight.speed + 1e-6);
	});

	test("boost raises the ceiling while held", () => {
		const normal = new PilotController();
		const boosted = new PilotController();
		hold(normal, 5, FORWARD);
		hold(boosted, 5, FORWARD, true);

		expect(boosted.speed).toBeGreaterThan(normal.speed);
		expect(boosted.speed).toBeLessThanOrEqual(
			DEFAULT_TUNING.maxSpeed * DEFAULT_TUNING.boostFactor + 1e-6
		);
	});

	test("releasing boost bleeds the extra speed back off", () => {
		const pilot = new PilotController();
		hold(pilot, 5, FORWARD, true);
		const boostedSpeed = pilot.speed;

		hold(pilot, 3, FORWARD, false);

		// Top speed is an asymptote, so the excess decays toward it rather than
		// snapping — within a percent after a few seconds is the honest claim.
		expect(pilot.speed).toBeLessThan(boostedSpeed);
		expect(pilot.speed).toBeLessThan(DEFAULT_TUNING.maxSpeed * 1.01);
		expect(pilot.speed).toBeGreaterThan(DEFAULT_TUNING.maxSpeed * 0.99);
	});
});

describe("coasting to a stop", () => {
	test("releasing the keys brings the ship to a full stop", () => {
		const pilot = new PilotController();
		hold(pilot, 2, FORWARD);
		expect(pilot.speed).toBeGreaterThan(0);

		hold(pilot, 5);

		// Exactly zero, not a vanishing remainder that drifts forever.
		expect(pilot.speed).toBe(0);
	});

	test("the ship keeps coasting for a moment instead of stopping dead", () => {
		const pilot = new PilotController();
		hold(pilot, 2, FORWARD);

		const coasted = hold(pilot, 0.1);

		expect(coasted.forward).toBeGreaterThan(0);
	});

	test("reset cuts the engines immediately", () => {
		const pilot = new PilotController();
		hold(pilot, 2, FORWARD);

		pilot.reset();

		expect(pilot.speed).toBe(0);
	});
});

describe("frame-rate independence", () => {
	test("the same hold covers the same distance at 30 and 120 fps", () => {
		// A stuttering machine must not fly a different route from a smooth one.
		const slow = new PilotController();
		const fast = new PilotController();

		const slowDistance = fly(slow, 2, 1 / 30, FORWARD).forward;
		const fastDistance = fly(fast, 2, 1 / 120, FORWARD).forward;

		expect(fastDistance).toBeCloseTo(slowDistance, 5);
		expect(fast.speed).toBeCloseTo(slow.speed, 5);
	});

	test("coasting decays at the same rate whatever the frame rate", () => {
		const slow = new PilotController();
		const fast = new PilotController();
		hold(slow, 2, FORWARD);
		hold(fast, 2, FORWARD);

		fly(slow, 0.5, 1 / 30);
		fly(fast, 0.5, 1 / 120);

		expect(fast.speed).toBeCloseTo(slow.speed, 5);
	});

	test("one long frame matches many short ones", () => {
		// The renderer will not deliver an even cadence; a single 50 ms hitch
		// must land the ship where five 10 ms frames would have.
		const stuttering = new PilotController();
		const smooth = new PilotController();

		const stutterDistance = fly(stuttering, 0.5, 0.05, FORWARD).forward;
		const smoothDistance = fly(smooth, 0.5, 0.01, FORWARD).forward;

		expect(stutterDistance).toBeCloseTo(smoothDistance, 5);
	});
});

describe("hostile frame times", () => {
	test("a long stall does not teleport the ship across the vault", () => {
		// Returning to a backgrounded tab hands over a multi-second delta.
		const pilot = new PilotController();
		hold(pilot, 2, FORWARD);

		const step = pilot.update(30, FORWARD);

		expect(step.forward).toBeLessThan(DEFAULT_TUNING.maxSpeed * 0.1 + 1e-6);
	});

	test("a zero or negative delta is a no-op", () => {
		const pilot = new PilotController();
		hold(pilot, 1, FORWARD);
		const speedBefore = pilot.speed;

		expect(pilot.update(0, FORWARD)).toEqual({ forward: 0, right: 0, up: 0 });
		expect(pilot.update(-5, FORWARD)).toEqual({ forward: 0, right: 0, up: 0 });
		expect(pilot.speed).toBe(speedBefore);
	});

	test("velocity stays finite through a long messy flight", () => {
		const pilot = new PilotController();
		const inputs: PilotInput[] = [FORWARD, DIAGONAL, NO_INPUT, { forward: -1, right: 0, up: 1 }];

		for (let i = 0; i < 2000; i++) {
			pilot.update(FRAME * ((i % 7) + 1), inputs[i % inputs.length], i % 3 === 0);
			expect(Number.isFinite(pilot.speed)).toBe(true);
		}
	});
});

describe("custom tuning", () => {
	test("a gentler ship accelerates more slowly", () => {
		const gentle = new PilotController({ ...DEFAULT_TUNING, acceleration: 100 });
		const brisk = new PilotController({ ...DEFAULT_TUNING, acceleration: 2000 });

		hold(gentle, 0.3, FORWARD);
		hold(brisk, 0.3, FORWARD);

		expect(gentle.speed).toBeLessThan(brisk.speed);
	});

	test("zero damping lets the ship drift on forever", () => {
		const pilot = new PilotController({ ...DEFAULT_TUNING, damping: 0, restSpeed: 0 });
		hold(pilot, 1, FORWARD);
		const speedBefore = pilot.speed;

		hold(pilot, 5);

		expect(pilot.speed).toBeCloseTo(speedBefore, 5);
	});
});
