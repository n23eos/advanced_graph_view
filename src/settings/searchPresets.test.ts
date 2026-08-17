import { describe, expect, test } from "vitest";
import { sortSearchPresets, validatePresetName } from "./searchPresets";
import type { SearchPreset } from "./schema";

const preset = (name: string, lastUsedAt?: number): SearchPreset => ({
	id: name,
	name,
	query: "q",
	createdAt: 1,
	updatedAt: 1,
	...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
});

describe("validatePresetName (F-09)", () => {
	test("trims and accepts 1–80 characters", () => {
		expect(validatePresetName("  Work  ")).toBe("Work");
		expect(validatePresetName("a".repeat(80))).toBe("a".repeat(80));
	});

	test("rejects empty, whitespace-only and over-long names", () => {
		expect(validatePresetName("")).toBeNull();
		expect(validatePresetName("   ")).toBeNull();
		expect(validatePresetName("a".repeat(81))).toBeNull();
	});
});

describe("sortSearchPresets", () => {
	test("recently used come first, the rest alphabetically", () => {
		const sorted = sortSearchPresets(
			[preset("b"), preset("a"), preset("old", 100), preset("fresh", 200)],
			"en"
		);
		expect(sorted.map((p) => p.name)).toEqual(["fresh", "old", "a", "b"]);
	});

	test("does not mutate the input", () => {
		const input = [preset("b"), preset("a")];
		sortSearchPresets(input, "en");
		expect(input.map((p) => p.name)).toEqual(["b", "a"]);
	});
});
