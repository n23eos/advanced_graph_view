import { describe, expect, test } from "vitest";
import { DEFAULT_EXPLORE_TUNING, ExploreController } from "./ExploreController";

const FRAME = 1 / 60;
const FLIGHT = DEFAULT_EXPLORE_TUNING.flightSeconds;

/**
 * Run the controller for `seconds` of simulated time, holding one aim, and
 * return every step it produced. Step count is derived up front rather than
 * accumulated, so the same journey really is the same journey at any frame
 * rate — the trick `PilotController.test.ts` already uses.
 */
function run(
	controller: ExploreController,
	seconds: number,
	aim: number | null = null,
	dt = FRAME
) {
	const steps = [];
	const count = Math.round(seconds / dt);
	for (let i = 0; i < count; i++) {
		controller.aimAt(aim);
		steps.push(controller.update(dt));
	}
	return steps;
}

/** Aim at `target`, click it, and wait out the flight. */
function hop(controller: ExploreController, target: number) {
	controller.aimAt(target);
	controller.jump();
	run(controller, FLIGHT + FRAME * 2, target);
}

describe("starting up", () => {
	test("a fresh controller sits on its start node with nothing aimed", () => {
		const controller = new ExploreController(7);

		expect(controller.currentId).toBe(7);
		expect(controller.candidateId).toBeNull();
		expect(controller.phase).toBe("aiming");
	});
});

describe("aiming at a link", () => {
	test("aiming lights a link up", () => {
		const controller = new ExploreController(0);

		controller.aimAt(1);

		expect(controller.candidateId).toBe(1);
	});

	test("aiming never travels on its own, however long it is held", () => {
		const controller = new ExploreController(0);

		const steps = run(controller, 30, 1);

		expect(steps.every((step) => step.departedTo === null)).toBe(true);
		expect(controller.phase).toBe("aiming");
		expect(controller.currentId).toBe(0);
	});

	test("aiming away drops the link again", () => {
		const controller = new ExploreController(0);

		controller.aimAt(1);
		controller.aimAt(null);

		expect(controller.candidateId).toBeNull();
	});

	test("the node the camera sits on is not a link to travel", () => {
		const controller = new ExploreController(4);

		controller.aimAt(4);

		expect(controller.candidateId).toBeNull();
	});
});

describe("clicking to travel", () => {
	test("a click departs towards the aimed node", () => {
		const controller = new ExploreController(0);

		controller.aimAt(1);
		controller.jump();
		const step = controller.update(FRAME);

		expect(step.departedTo).toBe(1);
		expect(controller.phase).toBe("flying");
		expect(controller.destinationId).toBe(1);
	});

	test("a click with nothing aimed does nothing", () => {
		const controller = new ExploreController(0);

		controller.jump();
		const step = controller.update(FRAME);

		expect(step.departedTo).toBeNull();
		expect(controller.phase).toBe("aiming");
	});

	test("a click mid-flight is ignored", () => {
		const controller = new ExploreController(0);

		controller.aimAt(1);
		controller.jump();
		controller.update(FRAME);
		controller.jump();
		const step = controller.update(FRAME);

		expect(step.departedTo).toBeNull();
		expect(controller.destinationId).toBe(1);
	});
});

describe("flying", () => {
	test("the flight ends on the destination", () => {
		const controller = new ExploreController(0);

		controller.aimAt(1);
		controller.jump();
		const steps = run(controller, FLIGHT + FRAME * 2, 1);

		expect(steps.filter((step) => step.arrivedAt === 1)).toHaveLength(1);
		expect(controller.currentId).toBe(1);
		expect(controller.phase).toBe("aiming");
		expect(controller.destinationId).toBeNull();
	});

	test("flight progress runs from 0 to 1", () => {
		const controller = new ExploreController(0);

		controller.aimAt(1);
		controller.jump();
		controller.update(FRAME);
		expect(controller.flightProgress).toBeLessThan(0.2);

		run(controller, FLIGHT / 2, 1);
		expect(controller.flightProgress).toBeGreaterThan(0.4);
		expect(controller.flightProgress).toBeLessThan(0.8);
	});

	test("aiming mid-flight cannot redirect the camera", () => {
		const controller = new ExploreController(0);

		controller.aimAt(1);
		controller.jump();
		controller.update(FRAME);
		run(controller, FLIGHT / 2, 5);

		expect(controller.destinationId).toBe(1);
		expect(controller.candidateId).toBeNull();
	});

	test("the same flight takes the same time at any frame rate", () => {
		const smooth = new ExploreController(0);
		const choppy = new ExploreController(0);

		for (const controller of [smooth, choppy]) {
			controller.aimAt(1);
			controller.jump();
		}
		// 0.3s divides evenly by both steps, so the two really do fly the same
		// journey and any difference is the model's fault, not rounding's.
		run(smooth, 0.3, null, 1 / 120);
		run(choppy, 0.3, null, 1 / 30);

		expect(choppy.flightProgress).toBeCloseTo(smooth.flightProgress, 5);
	});

	test("arriving leaves nothing aimed, so the next hop is a fresh choice", () => {
		const controller = new ExploreController(0);

		hop(controller, 1);

		expect(controller.candidateId).toBeNull();
	});
});

describe("walking back", () => {
	test("back flies to the previous node", () => {
		const controller = new ExploreController(0);

		hop(controller, 1);
		hop(controller, 2);
		controller.back();
		const steps = run(controller, FLIGHT + FRAME * 2);

		expect(steps.filter((step) => step.departedTo === 1)).toHaveLength(1);
		expect(controller.currentId).toBe(1);
	});

	test("back keeps unwinding rather than bouncing between two nodes", () => {
		const controller = new ExploreController(0);

		hop(controller, 1);
		hop(controller, 2);
		controller.back();
		run(controller, FLIGHT + FRAME * 2);
		controller.back();
		run(controller, FLIGHT + FRAME * 2);

		expect(controller.currentId).toBe(0);
		expect(controller.canGoBack).toBe(false);
	});

	test("back at the start of the trail does nothing", () => {
		const controller = new ExploreController(0);

		expect(controller.canGoBack).toBe(false);
		controller.back();
		const step = controller.update(FRAME);

		expect(step.departedTo).toBeNull();
		expect(controller.currentId).toBe(0);
	});

	test("the trail records where the camera has been", () => {
		const controller = new ExploreController(0);

		hop(controller, 1);
		hop(controller, 2);

		expect(controller.trail).toEqual([0, 1, 2]);
	});
});
