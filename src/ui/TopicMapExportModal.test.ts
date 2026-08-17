// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { ExportConflictModal, TopicMapExportModal } from "./TopicMapExportModal";
import type { App } from "obsidian";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

const draft = {
	name: "Topic map — a",
	folder: "maps",
	depth: 2,
	includeDirections: true,
	includeMetrics: true,
	includeInternalLinks: true,
};

describe("TopicMapExportModal (F-12)", () => {
	test("submits the edited options; depth slider only for rooted sources", () => {
		const onSubmit = vi.fn();
		const modal = new TopicMapExportModal({} as App, draft, true, onSubmit);
		modal.onOpen();
		const [name] = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>("input[type=text]"));
		name.value = "  My map  ";
		const checkbox = modal.contentEl.querySelector<HTMLInputElement>("input[type=checkbox]")!;
		checkbox.checked = false;
		(Array.from(modal.contentEl.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Export")) as HTMLButtonElement).click();
		expect(onSubmit).toHaveBeenCalledWith({ ...draft, name: "My map", includeDirections: false });
	});

	test("a flat source has no depth slider; an empty name blocks the export", () => {
		const onSubmit = vi.fn();
		const modal = new TopicMapExportModal({} as App, draft, false, onSubmit);
		modal.onOpen();
		expect(modal.contentEl.querySelector("input[type=range]")).toBeNull();
		const [name] = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement>("input[type=text]"));
		name.value = "  ";
		(Array.from(modal.contentEl.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Export")) as HTMLButtonElement).click();
		expect(onSubmit).not.toHaveBeenCalled();
	});
});

describe("ExportConflictModal", () => {
	test("buttons report their choice exactly once", () => {
		const onChoice = vi.fn();
		const modal = new ExportConflictModal({} as App, "Map.md", onChoice);
		modal.onOpen();
		(Array.from(modal.contentEl.querySelectorAll("button")).find((b) => b.textContent === "Create a copy") as HTMLButtonElement).click();
		modal.onClose();
		expect(onChoice).toHaveBeenCalledTimes(1);
		expect(onChoice).toHaveBeenCalledWith("copy");
	});

	test("closing without a pick counts as cancel", () => {
		const onChoice = vi.fn();
		const modal = new ExportConflictModal({} as App, "Map.md", onChoice);
		modal.onOpen();
		modal.onClose();
		expect(onChoice).toHaveBeenCalledWith("cancel");
	});
});
