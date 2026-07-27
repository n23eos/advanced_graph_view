import { describe, expect, test } from "vitest";
import { pickNodeAt } from "./hitTest";

/** Three nodes in a row at x = 0, 100, 200 (y = 0), radius 10 each. */
const ROW = {
	positions: new Float32Array([0, 0, 100, 0, 200, 0]),
	radii: new Float32Array([10, 10, 10]),
	hitRadius: 12,
};

describe("pickNodeAt", () => {
	test("a pointer on empty canvas picks nothing", () => {
		expect(pickNodeAt({ ...ROW, pointerX: 50, pointerY: 400 })).toBeNull();
	});

	test("a pointer on a node picks it", () => {
		expect(pickNodeAt({ ...ROW, pointerX: 100, pointerY: 0 })).toBe(1);
	});

	test("a near miss still picks, thanks to the forgiveness radius", () => {
		// 11px away: outside the 10px disc, inside the 12px hit radius.
		expect(pickNodeAt({ ...ROW, pointerX: 111, pointerY: 0 })).toBe(1);
	});

	test("beyond the forgiveness radius nothing is picked", () => {
		expect(pickNodeAt({ ...ROW, pointerX: 130, pointerY: 0 })).toBeNull();
	});

	test("overlapping candidates resolve to the nearest one", () => {
		// Arrange: two nodes 8px apart, pointer 3px from the first.
		const positions = new Float32Array([0, 0, 8, 0]);
		const radii = new Float32Array([20, 20]);

		// Act + Assert
		expect(pickNodeAt({ positions, radii, hitRadius: 12, pointerX: 3, pointerY: 0 })).toBe(0);
		expect(pickNodeAt({ positions, radii, hitRadius: 12, pointerX: 6, pointerY: 0 })).toBe(1);
	});

	test("a hidden node is not clickable, and does not shadow a visible one", () => {
		// Arrange: node 0 is hidden but sits right on top of node 1
		const positions = new Float32Array([0, 0, 2, 0]);
		const radii = new Float32Array([20, 20]);
		const hiddenMask = new Uint8Array([1, 0]);

		// Act + Assert
		expect(pickNodeAt({ positions, radii, hitRadius: 12, pointerX: 0, pointerY: 0, hiddenMask }))
			.toBe(1);
	});

	test("a node behind the camera (depth 0) is not clickable", () => {
		const depthScales = new Float32Array([0, 1, 1]);
		expect(pickNodeAt({ ...ROW, pointerX: 0, pointerY: 0, depthScales })).toBeNull();
	});

	test("in 3D the clickable disc scales with depth", () => {
		// Arrange: a far node (depth 0.2) shrinks to a 2px disc on screen.
		const positions = new Float32Array([0, 0]);
		const radii = new Float32Array([50]);
		const depthScales = new Float32Array([0.2]);

		// Act: 30px away — inside the raw 50px radius, outside the drawn 10px one
		const picked = pickNodeAt({
			positions,
			radii,
			hitRadius: 5,
			pointerX: 30,
			pointerY: 0,
			depthScales,
		});

		// Assert: a distant node must not swallow clicks over its drawn size
		expect(picked).toBeNull();
	});

	test("a near node's enlarged disc is clickable out to its drawn edge", () => {
		const positions = new Float32Array([0, 0]);
		const radii = new Float32Array([10]);
		const depthScales = new Float32Array([3]); // drawn at 30px

		expect(
			pickNodeAt({ positions, radii, hitRadius: 5, pointerX: 25, pointerY: 0, depthScales })
		).toBe(0);
	});

	test("an empty graph picks nothing", () => {
		expect(
			pickNodeAt({
				positions: new Float32Array(0),
				radii: new Float32Array(0),
				hitRadius: 12,
				pointerX: 0,
				pointerY: 0,
			})
		).toBeNull();
	});
});
