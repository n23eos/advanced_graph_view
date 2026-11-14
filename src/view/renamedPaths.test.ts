import { describe, expect, test } from "vitest";
import { recordRename, resolvePreviousPath, remapPinnedPaths, consumeRenames } from "./renamedPaths";

describe("rename tracking", () => {
	test("resolves one rename and keeps other paths unchanged", () => {
		const renamed = new Map<string, string>();
		recordRename(renamed, "a.md", "b.md");
		expect(resolvePreviousPath("b.md", renamed)).toBe("a.md");
		expect(resolvePreviousPath("other.md", renamed)).toBe("other.md");
	});
	test("collapses a chain and moves its pin to the final path", () => {
		const renamed = new Map<string, string>();
		recordRename(renamed, "a.md", "b.md");
		recordRename(renamed, "b.md", "c.md");
		expect([...renamed]).toEqual([["c.md", "a.md"]]);
		expect(remapPinnedPaths(["a.md", "other.md"], renamed)).toEqual(["c.md", "other.md"]);
	});
	test("tracks each note from folder rename events independently", () => {
		const renamed = new Map<string, string>();
		recordRename(renamed, "old/a.md", "new/a.md");
		recordRename(renamed, "old/b.md", "new/b.md");
		expect(remapPinnedPaths(["old/a.md", "old/b.md"], renamed)).toEqual(["new/a.md", "new/b.md"]);
	});
	test("does not confuse a new note reusing a previous path", () => {
		const renamed = new Map<string, string>();
		recordRename(renamed, "a.md", "b.md");
		recordRename(renamed, "c.md", "a.md");
		expect(resolvePreviousPath("b.md", renamed)).toBe("a.md");
		expect(resolvePreviousPath("a.md", renamed)).toBe("c.md");
	});
	test("consumes applied changes but rebases later renames onto the installed model", () => {
		const pending = new Map([["c.md", "a.md"], ["y.md", "x.md"]]);
		consumeRenames(pending, new Map([["b.md", "a.md"]]));
		expect([...pending]).toEqual([["c.md", "b.md"], ["y.md", "x.md"]]);
		consumeRenames(pending, new Map(pending));
		expect(pending.size).toBe(0);
	});
});
