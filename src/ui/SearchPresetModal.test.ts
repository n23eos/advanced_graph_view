// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { SearchPresetModal } from "./SearchPresetModal";
import type { App } from "obsidian";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

function build(initial = { name: "", query: "" }) {
	const onSubmit = vi.fn();
	const modal = new SearchPresetModal({} as App, "Save filter", initial, onSubmit);
	modal.onOpen();
	const content = modal.contentEl;
	const [nameInput, queryInput] = Array.from(content.querySelectorAll("input"));
	const save = Array.from(content.querySelectorAll("button")).find((b) => b.textContent === "Save")!;
	const error = () => content.querySelector(".graph-insight-preset-error")?.textContent ?? "";
	return { onSubmit, nameInput, queryInput, save, error };
}

describe("SearchPresetModal (F-09)", () => {
	test("an empty name blocks saving and explains the rule", () => {
		const { onSubmit, queryInput, save, error } = build();
		queryInput.value = "tag:#work";
		save.click();
		expect(onSubmit).not.toHaveBeenCalled();
		expect(error()).toBe("Name is required (1–80 characters)");
	});

	test("an invalid query blocks saving and shows the parser's message", () => {
		const { onSubmit, nameInput, queryInput, save, error } = build();
		nameInput.value = "Work";
		queryInput.value = "links:abc";
		save.click();
		expect(onSubmit).not.toHaveBeenCalled();
		expect(error()).toBe("Invalid value for links");
	});

	test("a valid draft is submitted trimmed", () => {
		const { onSubmit, nameInput, queryInput, save } = build();
		nameInput.value = "  Work  ";
		queryInput.value = " tag:#work ";
		save.click();
		expect(onSubmit).toHaveBeenCalledWith({ name: "Work", query: "tag:#work" });
	});

	test("editing starts from the existing values", () => {
		const { nameInput, queryInput } = build({ name: "Old", query: "tag:#old" });
		expect(nameInput.value).toBe("Old");
		expect(queryInput.value).toBe("tag:#old");
	});
});
