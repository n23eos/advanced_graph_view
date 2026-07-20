import { describe, expect, test } from "vitest";
import { computeMetric, normalizeValues, type NodeFacts } from "./metrics";

const NOW = new Date("2026-07-19T12:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function facts(overrides: Partial<NodeFacts>): NodeFacts {
	return {
		path: "a.md",
		folder: "",
		tags: [],
		inCount: 0,
		outCount: 0,
		unresolvedCount: 0,
		ctime: NOW - 30 * DAY_MS,
		mtime: NOW - DAY_MS,
		size: 1000,
		opensTotal: 0,
		pagerank: 0,
		cluster: "",
		opens7: 0,
		opens30: 0,
		opens90: 0,
		...overrides,
	};
}

describe("computeMetric (numeric)", () => {
	test("links-total sums in and out", () => {
		expect(computeMetric("links-total", facts({ inCount: 3, outCount: 2 }), NOW)).toBe(5);
	});

	test("recency-edit is higher for fresher notes", () => {
		const fresh = computeMetric("recency-edit", facts({ mtime: NOW - DAY_MS }), NOW) as number;
		const stale = computeMetric("recency-edit", facts({ mtime: NOW - 300 * DAY_MS }), NOW) as number;
		expect(fresh).toBeGreaterThan(stale);
	});

	test("age-created is higher for older notes", () => {
		const old = computeMetric("age-created", facts({ ctime: NOW - 900 * DAY_MS }), NOW) as number;
		const young = computeMetric("age-created", facts({ ctime: NOW - DAY_MS }), NOW) as number;
		expect(old).toBeGreaterThan(young);
	});

	test("opens metrics read the matching window", () => {
		const f = facts({ opensTotal: 100, opens30: 12 });
		expect(computeMetric("opens-total", f, NOW)).toBe(100);
		expect(computeMetric("opens-30", f, NOW)).toBe(12);
	});
});

describe("computeMetric (categorical)", () => {
	test("folder returns top-level folder", () => {
		expect(computeMetric("folder", facts({ folder: "projects/deep" }), NOW)).toBe("projects/deep");
	});

	test("tag returns first tag or empty", () => {
		expect(computeMetric("tag", facts({ tags: ["work", "idea"] }), NOW)).toBe("work");
		expect(computeMetric("tag", facts({ tags: [] }), NOW)).toBe("");
	});
});

describe("normalizeValues", () => {
	test("maps min..max linearly to 0..1", () => {
		const result = normalizeValues([0, 5, 10]);
		expect(Array.from(result)).toEqual([0, 0.5, 1]);
	});

	test("log mode compresses heavy tails", () => {
		const linear = normalizeValues([0, 10, 1000]);
		const logged = normalizeValues([0, 10, 1000], { log: true });
		expect(logged[1]).toBeGreaterThan(linear[1]); // middle value not crushed to ~0
		expect(logged[2]).toBe(1);
	});

	test("constant values normalize to 0.5 instead of NaN", () => {
		const result = normalizeValues([7, 7, 7]);
		expect(Array.from(result)).toEqual([0.5, 0.5, 0.5]);
	});
});
