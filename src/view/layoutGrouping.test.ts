import { describe, expect, test } from "vitest";
import type { NodeFacts } from "../encoding/metrics";
import {
	DEPTH_SPREAD,
	UNGROUPED,
	computeGroups,
	depthByAge,
	depthByCluster,
} from "./layoutGrouping";

function note(overrides: Partial<NodeFacts>): NodeFacts {
	return {
		path: "note.md",
		folder: "/",
		tags: [],
		inCount: 0,
		outCount: 0,
		unresolvedCount: 0,
		ctime: 0,
		mtime: 0,
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

describe("computeGroups", () => {
	test("links mode leaves everything ungrouped — the edges do the work", () => {
		const facts = [note({ folder: "a" }), note({ folder: "b" })];
		expect(Array.from(computeGroups("links", facts))).toEqual([UNGROUPED, UNGROUPED]);
	});

	test("notes in the same folder share a group", () => {
		const facts = [
			note({ folder: "projects" }),
			note({ folder: "daily" }),
			note({ folder: "projects" }),
		];

		const groups = computeGroups("folders", facts);

		expect(groups[0]).toBe(groups[2]);
		expect(groups[1]).not.toBe(groups[0]);
	});

	test("notes sharing a primary tag share a group", () => {
		const facts = [
			note({ tags: ["#work", "#urgent"] }),
			note({ tags: ["#home"] }),
			note({ tags: ["#work"] }),
		];

		const groups = computeGroups("tags", facts);

		expect(groups[0]).toBe(groups[2]);
		expect(groups[1]).not.toBe(groups[0]);
	});

	test("only the first tag counts, so a note joins exactly one group", () => {
		// A note listing #home second must not be pulled toward the #home clump.
		const facts = [note({ tags: ["#work", "#home"] }), note({ tags: ["#home"] })];

		const groups = computeGroups("tags", facts);

		expect(groups[0]).not.toBe(groups[1]);
	});

	test("untagged notes stay ungrouped rather than forming one giant clump", () => {
		const facts = [note({ tags: [] }), note({ tags: [] }), note({ tags: ["#a"] })];

		const groups = computeGroups("tags", facts);

		expect(groups[0]).toBe(UNGROUPED);
		expect(groups[1]).toBe(UNGROUPED);
		expect(groups[2]).not.toBe(UNGROUPED);
	});

	test("vault-root notes stay ungrouped in folder mode", () => {
		const facts = [note({ folder: "/" }), note({ folder: "" }), note({ folder: "inbox" })];

		const groups = computeGroups("folders", facts);

		expect(groups[0]).toBe(UNGROUPED);
		expect(groups[1]).toBe(UNGROUPED);
		expect(groups[2]).toBe(0);
	});

	test("group ids are dense, starting at zero", () => {
		const facts = [note({ folder: "/" }), note({ folder: "a" }), note({ folder: "b" })];

		expect(Array.from(computeGroups("folders", facts))).toEqual([UNGROUPED, 0, 1]);
	});

	test("an empty vault yields an empty grouping", () => {
		expect(computeGroups("folders", [])).toHaveLength(0);
	});
});

describe("depthByCluster", () => {
	test("clusters are spread across the depth range, centered on zero", () => {
		const depths = depthByCluster(new Int32Array([0, 1, 2, 3]), 4);

		expect(depths[0]).toBeLessThan(0);
		expect(depths[3]).toBeGreaterThan(0);
		expect(depths[0] + depths[3]).toBeCloseTo(0);
		expect(Math.max(...depths) - Math.min(...depths)).toBeLessThanOrEqual(DEPTH_SPREAD);
	});

	test("cluster order is preserved along the axis", () => {
		const depths = depthByCluster(new Int32Array([2, 0, 1]), 3);
		expect(depths[1]).toBeLessThan(depths[2]);
		expect(depths[2]).toBeLessThan(depths[0]);
	});

	test("a single cluster sits flat at the middle", () => {
		const depths = depthByCluster(new Int32Array([0, 0]), 1);
		expect(depths[0]).toBe(0);
		expect(depths[1]).toBe(0);
	});

	test("a zero cluster count does not divide by zero", () => {
		const depths = depthByCluster(new Int32Array([0]), 0);
		expect(Number.isFinite(depths[0])).toBe(true);
	});
});

describe("depthByAge", () => {
	test("the oldest note goes to the back and the newest to the front", () => {
		const facts = [note({ ctime: 300 }), note({ ctime: 100 }), note({ ctime: 200 })];

		const depths = depthByAge(facts);

		expect(depths[1]).toBeCloseTo(-DEPTH_SPREAD / 2);
		expect(depths[0]).toBeCloseTo(DEPTH_SPREAD / 2);
		expect(depths[2]).toBeCloseTo(0);
	});

	test("notes created at the same moment collapse to one plane", () => {
		const depths = depthByAge([note({ ctime: 5 }), note({ ctime: 5 })]);

		expect(depths[0]).toBe(depths[1]);
		expect(Number.isFinite(depths[0])).toBe(true);
	});

	test("an empty vault yields an empty axis", () => {
		expect(depthByAge([])).toHaveLength(0);
	});
});
