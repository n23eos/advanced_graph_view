// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { initI18n } from "../i18n";
import { installObsidianDom } from "../test/obsidianDom";
import { FilterChips } from "./FilterChips";
import styles from "../../styles.css?raw";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
	// Obsidian loads this file in production; jsdom needs the same CSS fixture.
	document.head.createEl("style").textContent = styles;
});

function build() {
	const onChange = vi.fn();
	const host = document.body.createDiv();
	const filters = new FilterChips(host, { onChange });
	return { host, filters, onChange };
}

describe("filter menus", () => {
	test("searches a long vocabulary while keeping selected values removable", async () => {
		const { host, filters } = build();
		filters.setVocabulary(["already-selected", ...Array.from({ length: 1000 }, (_, i) => `tag-${i}`)], []);
		filters.setSelection({ tags: new Set(["already-selected"]), folders: new Set() });
		host.querySelectorAll("button")[0].click();
		const search = host.querySelector("input[type=search]") as HTMLInputElement;
		search.focus();
		search.value = "tag-999";
		search.dispatchEvent(new Event("input"));
		await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
		expect(host.querySelector("input[type=search]")).toBe(search);
		expect(document.activeElement).toBe(search);
		const labels = [...host.querySelectorAll(".graph-insight-filter-row")].map((row) => row.textContent);
		expect(labels.filter((_, index) => !(host.querySelectorAll(".graph-insight-filter-row")[index] as HTMLElement).hidden))
			.toEqual(["#already-selected", "#tag-999"]);
		const hiddenRow = host.querySelector(".graph-insight-filter-row[hidden]") as HTMLElement;
		expect(getComputedStyle(hiddenRow).display).toBe("none");
	});

	test("pending search updates do not steal focus from a checkbox", async () => {
		const { host, filters } = build();
		filters.setVocabulary(["work"], []);
		host.querySelector("button")!.click();
		const search = host.querySelector("input[type=search]") as HTMLInputElement;
		search.value = "work";
		search.dispatchEvent(new Event("input"));
		const checkbox = host.querySelector("input[type=checkbox]") as HTMLInputElement;
		checkbox.focus();
		await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
		expect(document.activeElement).toBe(checkbox);
		filters.destroy();
	});

	test("Escape closes the menu and restores focus to its trigger", () => {
		const { host, filters } = build();
		filters.setVocabulary(["work"], []);
		const trigger = host.querySelector("button") as HTMLButtonElement;
		trigger.click();
		const search = host.querySelector("input[type=search]") as HTMLInputElement;
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(trigger);
	});

	test("Escape also closes the menu from a checkbox", () => {
		const { host, filters } = build();
		filters.setVocabulary(["work"], []);
		const trigger = host.querySelector("button") as HTMLButtonElement;
		trigger.click();
		const checkbox = host.querySelector("input[type=checkbox]") as HTMLInputElement;
		checkbox.focus();
		checkbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(trigger);
	});

	test("removing stale vocabulary selections informs the owner", () => {
		const { filters, onChange } = build();
		filters.setVocabulary(["work"], ["notes"]);
		filters.setSelection({ tags: new Set(["work"]), folders: new Set(["notes"]) });
		filters.setVocabulary([], ["notes"]);
		expect(onChange).toHaveBeenCalledWith({ tags: new Set(), folders: new Set(["notes"]) });
	});

	test("buttons expose expanded and selected state", () => {
		const { host, filters } = build();
		filters.setVocabulary(["work"], []);
		filters.setSelection({ tags: new Set(["work"]), folders: new Set() });
		const trigger = host.querySelector("button") as HTMLButtonElement;
		expect(trigger.getAttribute("aria-pressed")).toBe("true");
		expect(trigger.getAttribute("aria-controls")).toBeTruthy();
	});
});
