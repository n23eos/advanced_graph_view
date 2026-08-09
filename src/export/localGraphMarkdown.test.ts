import { describe, expect, it } from "vitest";
import { buildGraphModel } from "../data/GraphStore";
import { buildNeighborhood } from "../analysis/neighborhood";
import { localGraphMarkdown } from "./localGraphMarkdown";

/** A → B, A → E, E → A (mutual), D → A (inbound), B → C. */
function neighborhoodOfA(depth: number) {
	const files = ["A.md", "B.md", "C.md", "D.md", "E.md"];
	const resolved = {
		"A.md": { "B.md": 1, "E.md": 1 },
		"E.md": { "A.md": 1 },
		"D.md": { "A.md": 1 },
		"B.md": { "C.md": 1 },
	};
	const model = buildGraphModel(files, resolved, {});
	return buildNeighborhood(model, model.pathToId.get("A.md")!, depth);
}

describe("localGraphMarkdown", () => {
	it("titles the note with the root and the depth", () => {
		const markdown = localGraphMarkdown(neighborhoodOfA(2));

		expect(markdown).toContain("[[A]]");
		expect(markdown.startsWith("# ")).toBe(true);
		expect(markdown).toContain("2");
	});

	it("marks direction on the first ring: out, in, and mutual", () => {
		const markdown = localGraphMarkdown(neighborhoodOfA(1));

		expect(markdown).toContain("→ [[B]]");
		expect(markdown).toContain("← [[D]]");
		expect(markdown).toContain("↔ [[E]]");
	});

	it("names the note deeper rings were reached through", () => {
		const markdown = localGraphMarkdown(neighborhoodOfA(2));

		expect(markdown).toMatch(/\[\[C\]\].*\[\[B\]\]/);
	});

	it("groups rings under one heading per depth", () => {
		const markdown = localGraphMarkdown(neighborhoodOfA(2));

		const headings = markdown.split("\n").filter((line) => line.startsWith("## "));
		expect(headings).toHaveLength(2);
	});

	it("sorts each ring alphabetically for a stable diff-friendly export", () => {
		const markdown = localGraphMarkdown(neighborhoodOfA(1));

		const b = markdown.indexOf("[[B]]");
		const d = markdown.indexOf("[[D]]");
		const e = markdown.indexOf("[[E]]");
		expect(b).toBeGreaterThan(-1);
		expect(b).toBeLessThan(d);
		expect(d).toBeLessThan(e);
	});

	it("lists only the root title when the note has no links in range", () => {
		const files = ["Lone.md", "Other.md"];
		const model = buildGraphModel(files, { "Other.md": {} }, {});
		const sub = buildNeighborhood(model, model.pathToId.get("Lone.md")!, 3);

		const markdown = localGraphMarkdown(sub);

		expect(markdown).toContain("[[Lone]]");
		expect(markdown).not.toContain("## ");
	});
});
