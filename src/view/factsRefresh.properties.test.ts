import { describe, expect, test } from "vitest";
import type { NodeFacts } from "../encoding/metrics";
import { diffFacts } from "./factsRefresh";

const fact: NodeFacts = {
	path: "a.md", folder: "", tags: [], inCount: 0, outCount: 0, unresolvedCount: 0,
	ctime: 0, mtime: 0, size: 0, opensTotal: 0, pagerank: 0, cluster: "",
	opens7: 0, opens30: 0, opens90: 0,
	properties: { status: ["active"], team: ["core", "docs"] },
};

describe("property fact refresh", () => {
	test("deep-compares equivalent maps built with new objects and arrays", () => {
		expect(diffFacts([fact], [{ ...fact, properties: { team: ["core", "docs"], status: ["active"] } }]))
			.toEqual({ changed: false, groupingChanged: false });
	});

	const propertyChanges: Array<NodeFacts["properties"]> = [
		{ status: ["done"], team: ["core", "docs"] },
		{ status: ["active"], team: ["docs", "core"] },
		{ status: ["active"], priority: ["1"] },
		undefined,
	];
	test.each(propertyChanges)("reports property-only change without regrouping: %j", (properties) => {
		expect(diffFacts([fact], [{ ...fact, properties }]))
			.toEqual({ changed: true, groupingChanged: false });
	});
});
