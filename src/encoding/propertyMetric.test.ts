import { describe, expect, test } from "vitest";
import { buildEncoding } from "./encode";
import {
	computeMetric,
	isCategoricalMetric,
	isPropertyMetricId,
	propertyKeyFromMetric,
	propertyMetricId,
	type NodeFacts,
} from "./metrics";

function facts(path: string, properties?: NodeFacts["properties"]): NodeFacts {
	return {
		path, folder: "", tags: [], inCount: 0, outCount: 0, unresolvedCount: 0,
		ctime: 0, mtime: 0, size: 0, opensTotal: 0, pagerank: 0, cluster: "",
		opens7: 0, opens30: 0, opens90: 0, properties,
	};
}

describe("property metric ids", () => {
	test("round-trip normalized keys and reject malformed ids", () => {
		expect(propertyMetricId(" Status ")).toBe("prop:status");
		expect(propertyKeyFromMetric("prop:status")).toBe("status");
		expect(isPropertyMetricId("prop:status")).toBe(true);
		expect(isPropertyMetricId("prop:")).toBe(false);
		expect(isPropertyMetricId("prop: Status ")).toBe(false);
	});

	test("is categorical and uses the first normalized property value", () => {
		const metric = propertyMetricId("status");
		expect(isCategoricalMetric(metric)).toBe(true);
		expect(computeMetric(metric, facts("a.md", { status: ["Active", "Later"] }), 0)).toBe("Active");
		expect(computeMetric(metric, facts("b.md"), 0)).toBe("");
	});

	test("categorical encoding uses property values and leaves missing values neutral", () => {
		const encoding = buildEncoding([
			facts("a.md", { status: ["active"] }),
			facts("b.md", { status: ["active"] }),
			facts("c.md", { status: ["done"] }),
			facts("d.md"),
		], { size: null, color: "prop:status", glow: null }, "recency", 0);
		expect(encoding.categories).toEqual(["active", "active", "done", ""]);
		expect(encoding.tints[0]).toBe(encoding.tints[1]);
		expect(encoding.tints[0]).not.toBe(encoding.tints[2]);
		expect(encoding.tints[3]).toBe(-1);
	});
});
