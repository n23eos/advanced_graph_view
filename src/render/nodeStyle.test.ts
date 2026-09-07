import { describe, expect, test } from "vitest";
import { effectiveNodeStyle, isNodeStyle, nodeStyleFromPreset } from "./nodeStyle";

describe("node style", () => {
	test("derives the legacy appearance from its palette", () => {
		expect(nodeStyleFromPreset("galaxy")).toBe("glow");
		expect(nodeStyleFromPreset("nebula")).toBe("glow");
		expect(nodeStyleFromPreset("recency")).toBe("flat");
	});

	test("falls back from additive glow on a light theme", () => {
		expect(effectiveNodeStyle("glow", true)).toBe("flat");
		expect(effectiveNodeStyle("ring", true)).toBe("ring");
		expect(effectiveNodeStyle("glow", false)).toBe("glow");
	});

	test("validates persisted values", () => {
		expect(isNodeStyle("ring")).toBe(true);
		expect(isNodeStyle("auto")).toBe(false);
	});
});
