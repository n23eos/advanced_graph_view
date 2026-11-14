import { describe, expect, test } from "vitest";
import type { NodeFacts } from "../encoding/metrics";
import { matchesQuery, parseQuery, validateQuery } from "./QueryParser";

function facts(properties?: NodeFacts["properties"]): NodeFacts {
	return {
		path: "a.md", folder: "", tags: [], inCount: 0, outCount: 0, unresolvedCount: 0,
		ctime: 0, mtime: 0, size: 0, opensTotal: 0, pagerank: 0, cluster: "",
		opens7: 0, opens30: 0, opens90: 0, properties,
	};
}

function matches(query: string, properties?: NodeFacts["properties"]): boolean {
	return matchesQuery(parseQuery(query), facts(properties), 0);
}

describe("property queries", () => {
	test("matches scalar and list values exactly without case sensitivity", () => {
		expect(matches("prop:status=active", { status: ["Active"] })).toBe(true);
		expect(matches("prop:STATUS=ACTIVE", { status: ["active"] })).toBe(true);
		expect(matches("prop:team=core", { team: ["docs", "Core"] })).toBe(true);
		expect(matches("prop:status=act", { status: ["active"] })).toBe(false);
	});

	test("supports negation, missing keys, spaces, and equals signs in values", () => {
		expect(matches("-prop:status=done", { status: ["active"] })).toBe(true);
		expect(matches("-prop:status=done")).toBe(true);
		expect(matches('prop:"project status=in progress"', { "project status": ["In Progress"] })).toBe(true);
		expect(matches("prop:formula=a=b", { formula: ["a=b"] })).toBe(true);
	});

	test("validates missing keys and values as bad property values", () => {
		expect(validateQuery("prop:status=active")).toBeNull();
		expect(validateQuery("prop:status")).toMatchObject({ messageKey: "badValue", operator: "prop" });
		expect(validateQuery("prop:=active")).toMatchObject({ messageKey: "badValue", operator: "prop" });
		expect(validateQuery("prop:status=")).toMatchObject({ messageKey: "badValue", operator: "prop" });
	});
});
