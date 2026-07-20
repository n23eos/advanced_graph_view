import { describe, expect, test } from "vitest";
import { buildEncoding, MAX_RADIUS, MIN_RADIUS } from "./encode";
import type { NodeFacts } from "./metrics";

const NOW = new Date("2026-07-19T12:00:00Z").getTime();

function facts(path: string, overrides: Partial<NodeFacts>): NodeFacts {
	return {
		path,
		folder: "",
		tags: [],
		inCount: 0,
		outCount: 0,
		unresolvedCount: 0,
		ctime: NOW,
		mtime: NOW,
		size: 0,
		opensTotal: 0,
		pagerank: 0,
		cluster: "",
		opens7: 0,
		opens30: 0,
		opens90: 0,
		...overrides,
	};
}

describe("buildEncoding", () => {
	test("size channel maps metric range onto radius range", () => {
		// Arrange
		const nodes = [
			facts("small.md", { inCount: 0 }),
			facts("big.md", { inCount: 50 }),
		];

		// Act
		const encoding = buildEncoding(nodes, { size: "links-total", color: null, glow: null }, "recency", NOW);

		// Assert
		expect(encoding.sizes[0]).toBeCloseTo(MIN_RADIUS);
		expect(encoding.sizes[1]).toBeCloseTo(MAX_RADIUS);
	});

	test("categorical color gives same folder same tint", () => {
		// Arrange
		const nodes = [
			facts("a/x.md", { folder: "a" }),
			facts("a/y.md", { folder: "a" }),
			facts("b/z.md", { folder: "b" }),
		];

		// Act
		const encoding = buildEncoding(nodes, { size: null, color: "folder", glow: null }, "recency", NOW);

		// Assert
		expect(encoding.tints[0]).toBe(encoding.tints[1]);
		expect(encoding.tints[0]).not.toBe(encoding.tints[2]);
	});

	test("null channels produce neutral defaults", () => {
		// Arrange & Act
		const encoding = buildEncoding([facts("a.md", {})], { size: null, color: null, glow: null }, "recency", NOW);

		// Assert
		expect(encoding.sizes[0]).toBeGreaterThan(0);
		expect(encoding.glow[0]).toBe(1);
		expect(encoding.tints[0]).toBe(-1); // -1 = theme default color
	});
});
