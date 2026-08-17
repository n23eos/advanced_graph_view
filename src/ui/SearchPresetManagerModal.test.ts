// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { SearchPresetManagerModal, type SearchPresetManagerCallbacks } from "./SearchPresetManagerModal";
import type { SearchPreset } from "../settings/schema";
import type { App } from "obsidian";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

const preset = (id: string, name: string): SearchPreset => ({
	id, name, query: `tag:#${id}`, createdAt: 1, updatedAt: 1,
});

function build(presets: SearchPreset[], overrides: Partial<SearchPresetManagerCallbacks> = {}) {
	const callbacks: SearchPresetManagerCallbacks = {
		onApply: vi.fn(),
		onUpdate: vi.fn(async () => presets),
		onDuplicate: vi.fn(async () => presets),
		onDelete: vi.fn(async () => []),
		...overrides,
	};
	const modal = new SearchPresetManagerModal({} as App, presets, callbacks);
	modal.onOpen();
	return { modal, content: modal.contentEl };
}

const rowButtons = (content: HTMLElement, row: number): HTMLButtonElement[] =>
	Array.from(content.querySelectorAll(".graph-insight-preset-manager-row")[row].querySelectorAll("button"));

describe("SearchPresetManagerModal (F-09)", () => {
	test("renders every preset with its query", () => {
		const { content } = build([preset("a", "Work"), preset("b", "Work")]);
		expect(content.querySelectorAll(".graph-insight-preset-manager-row").length).toBe(2);
		expect(content.textContent).toContain("tag:#a");
		expect(content.textContent).toContain("tag:#b");
	});

	test("apply hands the exact preset to the host", () => {
		const onApply = vi.fn();
		const [first, second] = [preset("a", "Work"), preset("b", "Work")];
		const { content } = build([first, second], { onApply });
		rowButtons(content, 1)[0].click();
		expect(onApply).toHaveBeenCalledWith(second);
	});

	test("delete asks for confirmation and removes only the chosen twin", async () => {
		const onDelete = vi.fn(async () => [preset("b", "Work")]);
		const [first, second] = [preset("a", "Work"), preset("b", "Work")];
		const { content } = build([first, second], { onDelete });
		rowButtons(content, 0)[3].click();
		expect(onDelete).not.toHaveBeenCalled();
		const proceed = Array.from(document.querySelectorAll("button")).find(
			(b) => b.textContent === "Yes, continue"
		);
		expect(proceed).toBeDefined();
		proceed!.click();
		await Promise.resolve();
		expect(onDelete).toHaveBeenCalledWith(first);
		expect(content.querySelectorAll(".graph-insight-preset-manager-row").length).toBe(1);
	});
});
