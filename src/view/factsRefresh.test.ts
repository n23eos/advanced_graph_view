import { describe, expect, test } from "vitest";
import type { NodeFacts } from "../encoding/metrics";
import { carryMetrics, diffFacts } from "./factsRefresh";

const fact: NodeFacts = {
	path: "a.md", folder: "work", tags: ["old"], inCount: 0, outCount: 0, unresolvedCount: 0,
	ctime: 1, mtime: 2, size: 3, opensTotal: 0, opens7: 0, opens30: 0, opens90: 0,
	pagerank: 0.7, cluster: "Work",
};

describe("node fact refresh", () => {
	test("recognizes equal values in newly built facts", () => {
		expect(diffFacts([fact], [{ ...fact, tags: ["old"] }])).toEqual({ changed: false, groupingChanged: false });
	});
	test.each(["mtime", "ctime", "size", "opensTotal", "opens7", "opens30", "opens90"] as const)("refreshes %s without regrouping", (field) => {
		expect(diffFacts([fact], [{ ...fact, [field]: 99 }])).toEqual({ changed: true, groupingChanged: false });
	});
	test.each([{ tags: ["new"] }, { folder: "home" }, { tags: ["old", "new"] }])("regroups tag or folder edits %j", (change) => {
		expect(diffFacts([fact], [{ ...fact, ...change }])).toEqual({ changed: true, groupingChanged: true });
	});
	test("carries metrics without mutating either input", () => {
		const fresh = { ...fact, mtime: 20, pagerank: 0, cluster: "" };
		expect(carryMetrics([fact], [fresh])).toEqual([{ ...fresh, pagerank: 0.7, cluster: "Work" }]);
		expect(fresh.pagerank).toBe(0);
		expect(fact.mtime).toBe(2);
	});
});
