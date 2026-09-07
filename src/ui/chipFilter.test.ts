import { describe, expect, test } from "vitest";
import { compileChipFilter } from "./chipFilter";

describe("compiled chip filters", () => {
	test("uses OR within a kind and AND between tags and folders", () => {
		const filter = compileChipFilter(new Set(["work", "idea"]), new Set(["Projects"]));
		expect(filter.matches({ tags: ["work/client"], folder: "Projects/App" })).toBe(true);
		expect(filter.matches({ tags: ["idea"], folder: "Archive" })).toBe(false);
		expect(filter.matches({ tags: ["other"], folder: "Projects" })).toBe(false);
	});

	test("empty selections accept every note", () => {
		expect(compileChipFilter(new Set(), new Set()).matches({ tags: [], folder: "" })).toBe(true);
	});
});
