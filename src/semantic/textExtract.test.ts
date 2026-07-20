import { describe, expect, test } from "vitest";
import { contentHash, extractEmbeddingText } from "./textExtract";

describe("extractEmbeddingText", () => {
	test("prepends title and strips frontmatter", () => {
		// Arrange
		const raw = "---\ntags: [x]\n---\nТело заметки";

		// Act
		const text = extractEmbeddingText("Моя заметка", raw);

		// Assert
		expect(text).toContain("Моя заметка");
		expect(text).toContain("Тело заметки");
		expect(text).not.toContain("tags:");
	});

	test("strips fenced code blocks", () => {
		const raw = "До\n```js\nconst secret = 1;\n```\nПосле";
		const text = extractEmbeddingText("t", raw);
		expect(text).not.toContain("const secret");
		expect(text).toContain("До");
		expect(text).toContain("После");
	});

	test("truncates long bodies to the limit", () => {
		const raw = "а".repeat(5000);
		const text = extractEmbeddingText("t", raw);
		expect(text.length).toBeLessThanOrEqual(1600);
	});
});

describe("contentHash", () => {
	test("same text same hash, different text different hash", () => {
		expect(contentHash("abc")).toBe(contentHash("abc"));
		expect(contentHash("abc")).not.toBe(contentHash("abd"));
	});
});
