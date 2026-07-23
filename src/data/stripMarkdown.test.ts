import { describe, expect, test } from "vitest";
import { stripMarkdown } from "./stripMarkdown";

describe("stripMarkdown", () => {
	test("drops heading markers but keeps the words", () => {
		expect(stripMarkdown("## My Note")).toBe("My Note");
	});

	test("keeps link text, drops the URL", () => {
		expect(stripMarkdown("see [the docs](https://x.io) here")).toBe("see the docs here");
	});

	test("keeps wikilink alias when present", () => {
		expect(stripMarkdown("go to [[note-a|Note A]]")).toBe("go to Note A");
	});

	test("keeps wikilink target when no alias", () => {
		expect(stripMarkdown("go to [[Note A]]")).toBe("go to Note A");
	});

	test("removes images entirely", () => {
		expect(stripMarkdown("before ![alt](img.png) after").replace(/\s+/g, " ").trim()).toBe(
			"before after"
		);
	});

	test("strips bold and italic markers", () => {
		expect(stripMarkdown("**bold** and _italic_")).toBe("bold and italic");
	});

	test("removes fenced code blocks", () => {
		expect(stripMarkdown("text\n```\ncode()\n```\nmore").replace(/\s+/g, " ").trim()).toBe(
			"text more"
		);
	});

	test("keeps inline code content", () => {
		expect(stripMarkdown("run `npm test` now")).toBe("run npm test now");
	});

	test("strips list bullets", () => {
		expect(stripMarkdown("- one\n- two").replace(/\s+/g, " ").trim()).toBe("one two");
	});
});
