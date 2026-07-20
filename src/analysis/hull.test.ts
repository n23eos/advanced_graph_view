import { describe, expect, test } from "vitest";
import { convexHull, type Point } from "./hull";

describe("convexHull", () => {
	test("square with an interior point yields the 4 corners", () => {
		// Arrange
		const points: Point[] = [
			{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
			{ x: 5, y: 5 }, // interior — must be dropped
		];

		// Act
		const hull = convexHull(points);

		// Assert
		expect(hull).toHaveLength(4);
		expect(hull).not.toContainEqual({ x: 5, y: 5 });
	});

	test("collinear points collapse to the two extremes", () => {
		// Arrange
		const points: Point[] = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }];

		// Act
		const hull = convexHull(points);

		// Assert
		expect(hull).toHaveLength(2);
	});

	test("fewer than 3 points return as-is", () => {
		expect(convexHull([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
	});
});
