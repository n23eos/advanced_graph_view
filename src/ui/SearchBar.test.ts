// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { SearchBar, type SearchCallbacks, type SearchUiState } from "./SearchBar";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function build(overrides: Partial<SearchCallbacks> = {}) {
	const callbacks: SearchCallbacks = {
		onQueryChange: vi.fn(),
		onCommit: vi.fn(),
		onClear: vi.fn(),
		onSavePreset: vi.fn(),
		onPresetApplied: vi.fn(),
		onManagePresets: vi.fn(),
		onTasksMenu: vi.fn(),
		...overrides,
	};
	const host = document.body.createDiv();
	const bar = new SearchBar(host, callbacks);
	const input = host.querySelector("input") as HTMLInputElement;
	return { host, bar, input, callbacks };
}

function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.setSelectionRange(value.length, value.length);
	input.dispatchEvent(new Event("input"));
}

function press(input: HTMLInputElement, key: string): void {
	input.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
}

const state = (overrides: Partial<SearchUiState>): SearchUiState => ({
	mode: "idle",
	query: "",
	matchedCount: 0,
	totalCount: 0,
	isIndexingContent: false,
	...overrides,
});

const statusText = (host: HTMLElement): string =>
	host.querySelector(".graph-insight-search-status")?.textContent ?? "";

describe("search status (F-03)", () => {
	test("highlight mode shows the matched count after the aria throttle", () => {
		const { host, bar } = build();
		bar.setUiState(state({ mode: "highlight", matchedCount: 5, totalCount: 40 }));
		vi.advanceTimersByTime(300);
		expect(statusText(host)).toBe("Highlighted: 5");
	});

	test("filter mode shows shown-of-total and a removable chip of the query", () => {
		const onClear = vi.fn();
		const { host, bar } = build({ onClear });
		bar.setUiState(state({ mode: "filter", query: "tag:#work", matchedCount: 3, totalCount: 10 }));
		vi.advanceTimersByTime(300);
		expect(statusText(host)).toBe("Shown: 3 of 10");
		const chip = host.querySelector(".graph-insight-search-chip");
		expect(chip?.textContent).toContain("tag:#work");
		(chip?.querySelector("button") as HTMLButtonElement).click();
		expect(onClear).toHaveBeenCalled();
	});

	test("content indexing replaces the count until the index is ready", () => {
		const { host, bar } = build();
		bar.setUiState(state({ mode: "filter", query: "content:x", matchedCount: 0, totalCount: 10, isIndexingContent: true }));
		vi.advanceTimersByTime(300);
		expect(statusText(host)).toBe("Indexing…");
	});

	test("a parse error is shown immediately and marks the input", () => {
		const { host, bar, input } = build();
		bar.setUiState(state({
			mode: "filter", query: "links:>3",
			parseError: { messageKey: "badValue", operator: "links", tokenStart: 0, tokenEnd: 9 },
		}));
		expect(statusText(host)).toBe("Invalid value for links");
		expect(input.classList.contains("has-error")).toBe(true);
	});

	test("the Enter hint shows while highlighting until the first commit", () => {
		const { host, bar, input } = build();
		const hint = () => host.querySelector(".graph-insight-search-hint") as HTMLElement;
		bar.setUiState(state({ mode: "highlight", matchedCount: 1, totalCount: 2 }));
		expect(hint().hidden).toBe(false);
		type(input, "abc");
		press(input, "Enter");
		bar.setUiState(state({ mode: "highlight", matchedCount: 1, totalCount: 2 }));
		expect(hint().hidden).toBe(true);
	});
});

describe("escape semantics (F-03)", () => {
	test("first Escape closes open suggestions, second clears the query", () => {
		const onClear = vi.fn();
		const { host, bar, input } = build({ onClear });
		bar.setVocabulary(["work", "workshop"], []);
		type(input, "tag:wo");
		expect(host.querySelectorAll(".graph-insight-suggest-row").length).toBeGreaterThan(0);

		press(input, "Escape");
		expect(onClear).not.toHaveBeenCalled();
		expect(input.value).toBe("tag:wo");

		press(input, "Escape");
		expect(onClear).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("");
	});
});
