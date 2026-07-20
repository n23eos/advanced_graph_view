import { describe, expect, test } from "vitest";
import { Camera3D } from "./projection";

describe("Camera3D projection", () => {
	test("identity camera keeps xy and unit depth at z=0", () => {
		// Arrange
		const camera = new Camera3D();
		const xyz = new Float32Array([10, -20, 0]);
		const out = new Float32Array(2);
		const depth = new Float32Array(1);

		// Act
		camera.project(xyz, out, depth);

		// Assert
		expect(out[0]).toBeCloseTo(10);
		expect(out[1]).toBeCloseTo(-20);
		expect(depth[0]).toBeCloseTo(1);
	});

	test("points closer to camera (negative z) appear larger", () => {
		// Arrange
		const camera = new Camera3D();
		const xyz = new Float32Array([100, 0, -300, 100, 0, 300]);
		const out = new Float32Array(4);
		const depth = new Float32Array(2);

		// Act
		camera.project(xyz, out, depth);

		// Assert: near point projects farther from center and scales up
		expect(depth[0]).toBeGreaterThan(1);
		expect(depth[1]).toBeLessThan(1);
		expect(Math.abs(out[0])).toBeGreaterThan(Math.abs(out[2]));
	});

	test("yaw rotation by 90° moves x into depth axis", () => {
		// Arrange
		const camera = new Camera3D();
		camera.yaw = Math.PI / 2;
		const xyz = new Float32Array([100, 0, 0]);
		const out = new Float32Array(2);
		const depth = new Float32Array(1);

		// Act
		camera.project(xyz, out, depth);

		// Assert: x becomes depth, screen x collapses to ~0
		expect(Math.abs(out[0])).toBeLessThan(1);
		expect(depth[0]).not.toBeCloseTo(1, 2);
	});

	test("unprojectDelta inverts the screen-plane movement", () => {
		// Arrange
		const camera = new Camera3D();
		camera.yaw = 0.7;
		camera.pitch = -0.4;
		const xyz = new Float32Array([50, 60, 70]);
		const before = new Float32Array(2);
		const depth = new Float32Array(1);
		camera.project(xyz, before, depth);

		// Act: move point by screen delta, then re-project
		const [dx, dy, dz] = camera.unprojectDelta(24, -18, depth[0]);
		const moved = new Float32Array([xyz[0] + dx, xyz[1] + dy, xyz[2] + dz]);
		const after = new Float32Array(2);
		camera.project(moved, after, depth);

		// Assert: screen position moved by ~the requested delta
		expect(after[0] - before[0]).toBeCloseTo(24, 0);
		expect(after[1] - before[1]).toBeCloseTo(-18, 0);
	});

	test("disabled camera is a passthrough of xy", () => {
		// Arrange
		const camera = new Camera3D();
		camera.enabled = false;
		camera.yaw = 1;
		camera.pitch = 1;
		const xyz = new Float32Array([5, 6, 999]);
		const out = new Float32Array(2);
		const depth = new Float32Array(1);

		// Act
		camera.project(xyz, out, depth);

		// Assert
		expect(out[0]).toBe(5);
		expect(out[1]).toBe(6);
		expect(depth[0]).toBe(1);
	});
});

describe("flying camera", () => {
	test("fly forward brings a centered point closer (larger depth scale)", () => {
		const camera = new Camera3D();
		const xyz = new Float32Array([0, 0, 500]);
		const out = new Float32Array(2);
		const depth = new Float32Array(1);
		camera.project(xyz, out, depth);
		const before = depth[0];

		camera.fly(300);
		camera.project(xyz, out, depth);
		expect(depth[0]).toBeGreaterThan(before);
	});

	test("point behind the camera is hidden (depth 0)", () => {
		const camera = new Camera3D();
		camera.fly(1600); // past the point at z=500 (the eye sits at −focal)
		const xyz = new Float32Array([0, 0, 500]);
		const out = new Float32Array(2);
		const depth = new Float32Array(1);
		camera.project(xyz, out, depth);
		expect(depth[0]).toBe(0);
	});
});
