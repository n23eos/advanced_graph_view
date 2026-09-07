import { describe, expect, test } from "vitest";
import { overlapsAny } from "./labelCollision";

describe("label collision", () => {
	const occupied = [{ x: 10, y: 10, width: 20, height: 10 }];

	test("detects a real overlap", () => {
		expect(overlapsAny({ x: 20, y: 15, width: 20, height: 10 }, occupied)).toBe(true);
	});

	test("allows touching edges and separated labels", () => {
		expect(overlapsAny({ x: 30, y: 10, width: 20, height: 10 }, occupied)).toBe(false);
		expect(overlapsAny({ x: 0, y: 30, width: 5, height: 5 }, occupied)).toBe(false);
	});
});
