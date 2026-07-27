import { describe, expect, test } from "vitest";
import {
	DRAG_THRESHOLD_PX,
	dragTargetPosition,
	isDragGesture,
	isDraggableDepth,
} from "./dragMath";
import { Camera3D } from "./projection";

describe("drag gesture threshold", () => {
	test("a still pointer is not a drag", () => {
		expect(isDragGesture(100, 100, 100, 100)).toBe(false);
	});

	test("jitter below the threshold is not a drag", () => {
		expect(isDragGesture(100, 100, 102, 100)).toBe(false);
	});

	test("travel at the threshold starts a drag", () => {
		expect(isDragGesture(100, 100, 100 + DRAG_THRESHOLD_PX, 100)).toBe(true);
	});

	test("diagonal travel counts, not just one axis", () => {
		// 3-4-5 triangle: 5px of travel from two sub-threshold components.
		expect(isDragGesture(0, 0, 3, 4)).toBe(true);
	});
});

describe("depth guard", () => {
	test("a node in front of the camera is draggable", () => {
		expect(isDraggableDepth(1)).toBe(true);
		expect(isDraggableDepth(0.02)).toBe(true);
	});

	test("depth 0 (behind the near plane) is refused", () => {
		expect(isDraggableDepth(0)).toBe(false);
	});

	test("non-finite depth is refused", () => {
		expect(isDraggableDepth(NaN)).toBe(false);
		expect(isDraggableDepth(Infinity)).toBe(false);
	});
});

describe("dragTargetPosition — flat mode", () => {
	test("node lands exactly on the pointer and keeps its z", () => {
		// Arrange
		const camera = new Camera3D();
		camera.enabled = false;

		// Act
		const target = dragTargetPosition({
			camera,
			current: { x: 0, y: 0, z: 77 },
			pointerWorldX: 250,
			pointerWorldY: -130,
			projectedX: 0,
			projectedY: 0,
			depthScale: 1,
		});

		// Assert
		expect(target).toEqual({ x: 250, y: -130, z: 77 });
	});

	test("a null camera behaves like flat mode", () => {
		const target = dragTargetPosition({
			camera: null,
			current: { x: 5, y: 5, z: 5 },
			pointerWorldX: 42,
			pointerWorldY: 43,
			projectedX: 0,
			projectedY: 0,
			depthScale: 0, // would be refused in 3D; irrelevant when flat
		});

		expect(target).toEqual({ x: 42, y: 43, z: 5 });
	});
});

describe("dragTargetPosition — 3D mode", () => {
	/** Project one node and hand back everything the drag math needs. */
	function projectOne(camera: Camera3D, x: number, y: number, z: number) {
		const out = new Float32Array(2);
		const depth = new Float32Array(1);
		camera.project(new Float32Array([x, y, z]), out, depth);
		return { projectedX: out[0], projectedY: out[1], depthScale: depth[0] };
	}

	test("the node tracks the pointer 1:1 on screen", () => {
		// Arrange: an off-axis camera, so a naive implementation would drift.
		const camera = new Camera3D();
		camera.yaw = 0.6;
		camera.pitch = -0.35;
		const current = { x: 120, y: -40, z: 260 };
		const seen = projectOne(camera, current.x, current.y, current.z);

		// Act: ask for the node to sit 60px right and 25px up from where it is.
		const pointerWorldX = seen.projectedX + 60;
		const pointerWorldY = seen.projectedY - 25;
		const target = dragTargetPosition({ camera, current, pointerWorldX, pointerWorldY, ...seen })!;

		// Assert: re-projecting the new position lands under the pointer.
		const after = projectOne(camera, target.x, target.y, target.z);
		expect(after.projectedX).toBeCloseTo(pointerWorldX, 0);
		expect(after.projectedY).toBeCloseTo(pointerWorldY, 0);
	});

	test("dragging keeps the node at its own depth, so it does not resize", () => {
		// Arrange
		const camera = new Camera3D();
		camera.yaw = 0.4;
		camera.pitch = 0.2;
		const current = { x: 0, y: 0, z: 300 };
		const seen = projectOne(camera, current.x, current.y, current.z);

		// Act
		const target = dragTargetPosition({
			camera,
			current,
			pointerWorldX: seen.projectedX + 90,
			pointerWorldY: seen.projectedY + 40,
			...seen,
		})!;

		// Assert: depth scale drives on-screen size. Unchanged scale means the
		// node slid across the view instead of swinging toward or away from the
		// eye — a swing would make it visibly swell mid-drag.
		const after = projectOne(camera, target.x, target.y, target.z);
		expect(after.depthScale).toBeCloseTo(seen.depthScale, 5);
	});

	test("a pointer that has not moved leaves the node exactly where it was", () => {
		const camera = new Camera3D();
		camera.yaw = 1.1;
		camera.pitch = -0.5;
		const current = { x: -80, y: 15, z: 140 };
		const seen = projectOne(camera, current.x, current.y, current.z);

		const target = dragTargetPosition({
			camera,
			current,
			pointerWorldX: seen.projectedX,
			pointerWorldY: seen.projectedY,
			...seen,
		})!;

		expect(target.x).toBeCloseTo(current.x, 5);
		expect(target.y).toBeCloseTo(current.y, 5);
		expect(target.z).toBeCloseTo(current.z, 5);
	});

	test("a node behind the camera refuses the move instead of exploding", () => {
		// Arrange: fly past the node so project() reports depth 0.
		const camera = new Camera3D();
		camera.fly(2000);
		const current = { x: 0, y: 0, z: 500 };
		const seen = projectOne(camera, current.x, current.y, current.z);
		expect(seen.depthScale).toBe(0); // guard the premise of this test

		// Act
		const target = dragTargetPosition({
			camera,
			current,
			pointerWorldX: 10,
			pointerWorldY: 10,
			...seen,
		});

		// Assert: null, not an Infinity-poisoned position.
		expect(target).toBeNull();
	});

	test("a NaN pointer never reaches the layout", () => {
		const camera = new Camera3D();
		const current = { x: 0, y: 0, z: 0 };

		const target = dragTargetPosition({
			camera,
			current,
			pointerWorldX: NaN,
			pointerWorldY: 0,
			projectedX: 0,
			projectedY: 0,
			depthScale: 1,
		});

		expect(target).toBeNull();
	});
});
