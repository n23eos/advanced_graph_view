import { beforeEach, describe, expect, test } from "vitest";
import { initI18n } from "../i18n";
import { categoricalMetricOptions, metricLabel } from "./metricLabels";

describe("property metric labels", () => {
	beforeEach(() => initI18n("en"));

	test("labels a dynamic metric with its property key", () => {
		expect(metricLabel("prop:status")).toBe("Property: status");
	});

	test("builds options from discovered keys and retains an active missing key", () => {
		const options = categoricalMetricOptions(["status", "team"], "prop:missing");
		expect(Object.keys(options).slice(-3)).toEqual(["prop:status", "prop:team", "prop:missing"]);
		expect(options["prop:status"]).toBe("Property: status");
	});
});
