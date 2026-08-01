import { describe, expect, test } from "vitest";
import { seededRandom } from "./seededRandom";

describe("seededRandom", () => {
	test("the same seed replays the same sequence", () => {
		// Arrange
		const first = seededRandom(42);
		const second = seededRandom(42);

		// Act
		const a = Array.from({ length: 20 }, () => first());
		const b = Array.from({ length: 20 }, () => second());

		// Assert
		expect(b).toEqual(a);
	});

	test("different seeds diverge", () => {
		// Arrange
		const first = seededRandom(1);
		const second = seededRandom(2);

		// Act
		const a = Array.from({ length: 20 }, () => first());
		const b = Array.from({ length: 20 }, () => second());

		// Assert
		expect(b).not.toEqual(a);
	});

	test("stays inside [0, 1)", () => {
		// Arrange
		const random = seededRandom(7);

		// Act & Assert
		for (let i = 0; i < 1000; i++) {
			const value = random();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});
