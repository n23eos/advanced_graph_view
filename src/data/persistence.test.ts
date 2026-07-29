import { describe, expect, it } from "vitest";
import { normalizeSavedPositions } from "./persistence";

describe("normalizeSavedPositions", () => {
	it("reads the legacy bare position map as a map with no pins", () => {
		// Arrange: everything written before pins existed is a bare path→coords map.
		const legacy = { "a.md": [1, 2, 3], "b.md": [4, 5] };

		// Act
		const result = normalizeSavedPositions(legacy);

		// Assert
		expect(result).toEqual({ positions: { "a.md": [1, 2, 3], "b.md": [4, 5] }, pins: [] });
	});

	it("reads the current envelope as-is", () => {
		const saved = { positions: { "a.md": [1, 2, 3] }, pins: ["a.md"] };

		expect(normalizeSavedPositions(saved)).toEqual(saved);
	});

	it("tolerates an envelope whose pins field is missing or not an array", () => {
		expect(normalizeSavedPositions({ positions: { "a.md": [0, 0] } })?.pins).toEqual([]);
		expect(normalizeSavedPositions({ positions: {}, pins: "a.md" })?.pins).toEqual([]);
	});

	it("drops pin entries that are not strings", () => {
		const result = normalizeSavedPositions({ positions: {}, pins: ["a.md", 7, null] });

		expect(result?.pins).toEqual(["a.md"]);
	});

	it("returns null for a payload that is not an object", () => {
		expect(normalizeSavedPositions(null)).toBeNull();
		expect(normalizeSavedPositions("nonsense")).toBeNull();
		expect(normalizeSavedPositions([1, 2])).toBeNull();
	});
});
