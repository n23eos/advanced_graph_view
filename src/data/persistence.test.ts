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

	it("keeps a legacy note whose path is positions", () => {
		expect(normalizeSavedPositions({ positions: [1, 2] })).toEqual({
			positions: { positions: [1, 2] },
			pins: [],
		});
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
		const result = normalizeSavedPositions({ positions: { "a.md": [0, 0] }, pins: ["a.md", 7, null] });

		expect(result?.pins).toEqual(["a.md"]);
	});

	it("keeps only coordinates that remain finite as Float32 values", () => {
		const result = normalizeSavedPositions({
			positions: {
				"old.md": [1, 2],
				"current.md": [3, 4, 5],
				"object.md": { x: 6, y: 7 },
				"short.md": [8],
				"long.md": [9, 10, 11, 12],
				"string.md": ["13", 14],
				"overflow.md": [3.5e38, 15],
			},
			pins: ["old.md", "overflow.md", "old.md", 7],
		});

		expect(result).toEqual({
			positions: {
				"old.md": [1, 2],
				"current.md": [3, 4, 5],
			},
			pins: ["old.md"],
		});
	});

	it("rejects an envelope without an object position map", () => {
		expect(normalizeSavedPositions({ positions: null, pins: ["a.md"] })).toBeNull();
		expect(normalizeSavedPositions({ positions: [], pins: ["a.md"] })).toBeNull();
	});

	it("returns null for a payload that is not an object", () => {
		expect(normalizeSavedPositions(null)).toBeNull();
		expect(normalizeSavedPositions("nonsense")).toBeNull();
		expect(normalizeSavedPositions([1, 2])).toBeNull();
	});
});
