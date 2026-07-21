import { describe, expect, test } from "vitest";
import { PilotController, clampPitch, stepSpeed, type ShipCamera } from "./PilotController";

function stubCamera(): ShipCamera & { flown: number; strafedR: number; strafedU: number } {
	return {
		yaw: 0,
		pitch: 0,
		flown: 0,
		strafedR: 0,
		strafedU: 0,
		fly(d) {
			this.flown += d;
		},
		strafe(r, u) {
			this.strafedR += r;
			this.strafedU += u;
		},
	};
}

describe("stepSpeed", () => {
	test("accelerates toward max while the throttle is held", () => {
		// Arrange
		let v = 0;
		// Act: many small steps at full forward intent
		for (let i = 0; i < 200; i++) v = stepSpeed(v, 1, 0.016, 420);
		// Assert
		expect(v).toBeGreaterThan(400);
		expect(v).toBeLessThanOrEqual(420);
	});

	test("coasts back to rest when the throttle is released", () => {
		let v = 420;
		for (let i = 0; i < 400; i++) v = stepSpeed(v, 0, 0.016, 420);
		expect(v).toBeLessThan(1);
	});

	test("never overshoots the target speed in one step", () => {
		expect(stepSpeed(0, 1, 1000, 420)).toBeLessThanOrEqual(420);
	});

	test("is frame-rate independent (same total time, same result)", () => {
		let big = 0;
		big = stepSpeed(big, 1, 0.1, 420);
		let small = 0;
		for (let i = 0; i < 10; i++) small = stepSpeed(small, 1, 0.01, 420);
		expect(Math.abs(big - small)).toBeLessThan(1);
	});
});

describe("clampPitch", () => {
	test("keeps pitch inside the limit", () => {
		expect(clampPitch(10, 1.45)).toBe(1.45);
		expect(clampPitch(-10, 1.45)).toBe(-1.45);
		expect(clampPitch(0.5, 1.45)).toBe(0.5);
	});
});

describe("PilotController", () => {
	test("flying forward moves the camera along its look axis", () => {
		// Arrange
		const cam = stubCamera();
		const pilot = new PilotController();
		pilot.setIntent({ forward: 1, strafe: 0, lift: 0, boost: false });

		// Act: half a second of flight
		for (let i = 0; i < 30; i++) pilot.update(cam, 16);

		// Assert
		expect(cam.flown).toBeGreaterThan(0);
	});

	test("strafing moves the camera sideways, not forward", () => {
		// Arrange
		const cam = stubCamera();
		const pilot = new PilotController();
		pilot.setIntent({ forward: 0, strafe: 1, lift: 0, boost: false });

		// Act
		for (let i = 0; i < 30; i++) pilot.update(cam, 16);

		// Assert
		expect(cam.strafedR).toBeGreaterThan(0);
		expect(cam.flown).toBe(0);
	});

	test("idle with no input reports no movement", () => {
		const cam = stubCamera();
		const pilot = new PilotController();
		expect(pilot.update(cam, 16)).toBe(false);
	});

	test("mouse look turns yaw and inverts+clamps pitch", () => {
		// Arrange
		const cam = stubCamera();
		const pilot = new PilotController();

		// Act
		pilot.addLook(100, 100);
		const moved = pilot.update(cam, 16);

		// Assert
		expect(moved).toBe(true);
		expect(cam.yaw).toBeGreaterThan(0);
		expect(cam.pitch).toBeLessThan(0); // dragging down looks down
	});

	test("reset stops the ship dead", () => {
		const cam = stubCamera();
		const pilot = new PilotController();
		pilot.setIntent({ forward: 1, strafe: 0, lift: 0, boost: false });
		for (let i = 0; i < 30; i++) pilot.update(cam, 16);
		pilot.reset();
		const before = cam.flown;
		pilot.update(cam, 16);
		expect(cam.flown).toBe(before); // no further motion
	});
});
