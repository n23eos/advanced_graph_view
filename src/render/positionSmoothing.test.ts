import { describe, expect, it } from "vitest";
import { SMOOTH_SNAP_EPSILON, easePositions } from "./positionSmoothing";

describe("easePositions", () => {
	it("moves current a fraction of the way toward target", () => {
		// Arrange
		const current = new Float32Array([0, 0, 0]);
		const target = new Float32Array([10, 20, 30]);

		// Act
		easePositions(current, target, 0.5);

		// Assert
		expect(Array.from(current)).toEqual([5, 10, 15]);
	});

	it("reports still-moving while the gap is above the snap epsilon", () => {
		// Arrange
		const current = new Float32Array([0, 0, 0]);
		const target = new Float32Array([10, 0, 0]);

		// Act
		const moving = easePositions(current, target, 0.5);

		// Assert
		expect(moving).toBe(true);
	});

	it("snaps to target and reports settled once inside the epsilon", () => {
		// Arrange
		const current = new Float32Array([0, 0, 0]);
		const target = new Float32Array([SMOOTH_SNAP_EPSILON / 2, 0, 0]);

		// Act
		const moving = easePositions(current, target, 0.5);

		// Assert
		expect(moving).toBe(false);
		expect(current[0]).toBe(target[0]);
	});

	it("converges to the target after repeated frames", () => {
		// Arrange
		const current = new Float32Array([0, 0, 0]);
		const target = new Float32Array([100, -50, 25]);

		// Act
		let frames = 0;
		while (easePositions(current, target, 0.35) && frames < 1000) frames++;

		// Assert
		expect(frames).toBeLessThan(100);
		expect(Array.from(current)).toEqual(Array.from(target));
	});

	it("reports settled when a coordinate is already exact", () => {
		// Arrange
		const current = new Float32Array([7, 7, 7]);
		const target = new Float32Array([7, 7, 7]);

		// Act
		const moving = easePositions(current, target, 0.35);

		// Assert
		expect(moving).toBe(false);
	});

	it("treats a length mismatch as nothing to ease", () => {
		// Arrange
		const current = new Float32Array([1, 2, 3]);
		const target = new Float32Array([1, 2, 3, 4, 5, 6]);

		// Act
		const moving = easePositions(current, target, 0.35);

		// Assert
		expect(moving).toBe(false);
		expect(Array.from(current)).toEqual([1, 2, 3]);
	});
});
