import { describe, expect, test } from "vitest";
import {
	DEFAULT_EXPLORE_DISTANCE,
	MIN_EXPLORE_DISTANCE,
	easeInOutCubic,
	flightPosition,
	framingDistance,
	viewpointFor,
	keptDistance,
} from "./cameraFlight";

const ORIGIN = { x: 0, y: 0, z: 0 };
/** Looking straight down +z, the axis `Camera3D.forward()` returns at rest. */
const FORWARD_Z: [number, number, number] = [0, 0, 1];

describe("where the camera stands to look at a node", () => {
	test("it sits one distance behind the node, along the look axis", () => {
		const pose = viewpointFor({ x: 10, y: 20, z: 30 }, FORWARD_Z, 400);

		expect(pose).toEqual({ x: 10, y: 20, z: -370 });
	});

	test("the look direction decides which side it stands on", () => {
		const fromLeft = viewpointFor(ORIGIN, [1, 0, 0], 100);
		const fromRight = viewpointFor(ORIGIN, [-1, 0, 0], 100);

		expect(fromLeft.x).toBe(-100);
		expect(fromRight.x).toBe(100);
	});

	test("the node always ends up exactly one distance away", () => {
		const target = { x: -5, y: 8, z: 2 };
		const forward: [number, number, number] = [0.6, 0, 0.8]; // unit length

		const pose = viewpointFor(target, forward, 250);

		expect(Math.hypot(pose.x - target.x, pose.y - target.y, pose.z - target.z)).toBeCloseTo(250, 6);
	});
});

describe("framing a neighbourhood", () => {
	test("a wider neighbourhood is watched from further back", () => {
		expect(framingDistance(600)).toBeGreaterThan(framingDistance(300));
	});

	test("the camera always stays outside the neighbourhood", () => {
		// This is the invariant that matters: standing closer than the links
		// reach puts nodes right in front of the lens, where they swell over
		// the whole screen and the graph reads as one blob.
		for (const spread of [10, 60, 200, 500, 900, 5000]) {
			expect(framingDistance(spread)).toBeGreaterThan(spread);
		}
	});

	test("a node whose links are all but on top of it still gets standing room", () => {
		expect(framingDistance(10)).toBe(MIN_EXPLORE_DISTANCE);
	});

	test("a node with nothing around it falls back to the default", () => {
		expect(framingDistance(0)).toBe(DEFAULT_EXPLORE_DISTANCE);
		expect(framingDistance(-5)).toBe(DEFAULT_EXPLORE_DISTANCE);
		expect(framingDistance(NaN)).toBe(DEFAULT_EXPLORE_DISTANCE);
	});
});

describe("keeping the scale across a hop", () => {
	test("the distance the camera already had is what it keeps", () => {
		expect(keptDistance({ x: 0, y: 0, z: 0 }, { x: 500, y: 0, z: 0 })).toBe(500);
	});

	test("a wheel-zoomed-out camera keeps its distance, however far", () => {
		expect(keptDistance({ x: 0, y: 0, z: 0 }, { x: 9000, y: 0, z: 0 })).toBe(9000);
	});

	test("standing inside the node is not a scale to keep", () => {
		expect(keptDistance({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 })).toBe(MIN_EXPLORE_DISTANCE);
		expect(keptDistance({ x: 7, y: 7, z: 7 }, { x: 7, y: 7, z: 7 })).toBe(
			DEFAULT_EXPLORE_DISTANCE
		);
	});

	test("with no node to measure against it falls back to the default", () => {
		expect(keptDistance({ x: 0, y: 0, z: 0 }, null)).toBe(DEFAULT_EXPLORE_DISTANCE);
	});
});

describe("easing", () => {
	test("it starts at 0, ends at 1 and passes through the middle", () => {
		expect(easeInOutCubic(0)).toBe(0);
		expect(easeInOutCubic(1)).toBe(1);
		expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
	});

	test("it never goes backwards", () => {
		let previous = -1;
		for (let step = 0; step <= 20; step++) {
			const value = easeInOutCubic(step / 20);
			expect(value).toBeGreaterThanOrEqual(previous);
			previous = value;
		}
	});

	test("it is slow at both ends — that is the whole point", () => {
		// Linear would put a quarter of the trip behind you at t = 0.25.
		expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
		expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
	});
});

describe("flying between two viewpoints", () => {
	const from = { x: 0, y: 0, z: 0 };
	const to = { x: 100, y: 200, z: -300 };

	test("the flight starts where the camera already is", () => {
		expect(flightPosition(from, to, 0)).toEqual(from);
	});

	test("the flight lands exactly on the destination viewpoint", () => {
		expect(flightPosition(from, to, 1)).toEqual(to);
	});

	test("halfway is halfway", () => {
		const middle = flightPosition(from, to, 0.5);

		expect(middle.x).toBeCloseTo(50, 6);
		expect(middle.y).toBeCloseTo(100, 6);
		expect(middle.z).toBeCloseTo(-150, 6);
	});

	test("progress outside 0..1 cannot overshoot the ends", () => {
		expect(flightPosition(from, to, -3)).toEqual(from);
		expect(flightPosition(from, to, 7)).toEqual(to);
	});

	test("the camera eases rather than sliding at a constant rate", () => {
		expect(flightPosition(from, to, 0.25).x).toBeLessThan(25);
	});
});
