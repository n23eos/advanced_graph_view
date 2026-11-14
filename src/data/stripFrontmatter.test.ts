import { describe, expect, test } from "vitest";
import { stripFrontmatter } from "./stripMarkdown";

describe("frontmatter in note previews", () => {
	test.each(["\n", "\r\n"])("strips frontmatter with line ending %j", (newline) => {
		expect(stripFrontmatter(["---", "title: hidden", "---", "Visible body"].join(newline))).toBe("Visible body");
	});
	test("keeps body separators and notes without frontmatter", () => {
		const body = "Visible body\n---\nMore text";
		expect(stripFrontmatter(body)).toBe(body);
		expect(stripFrontmatter("---\nunfinished")).toBe("---\nunfinished");
	});
});
