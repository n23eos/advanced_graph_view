// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { ChangesPanel, type ChangesData, type ChangesPanelCallbacks } from "./ChangesPanel";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

const data = (overrides: Partial<ChangesData> = {}): ChangesData => ({
	hasHistory: true,
	hasMetrics: true,
	newNotes: ["a.md"],
	editedNotes: ["b.md", "c.md"],
	addedLinks: [{ fromPath: "a.md", toPath: "b.md" }],
	removedLinks: [],
	growingHubs: ["b.md"],
	coolingClusters: [{ id: 3, label: "Projects" }],
	...overrides,
});

function build(overrides: Partial<ChangesPanelCallbacks> = {}) {
	const callbacks: ChangesPanelCallbacks = {
		onPeriodChange: vi.fn(),
		onCategorySelect: vi.fn(),
		onOpenNote: vi.fn(),
		onFocusLink: vi.fn(),
		onFocusCluster: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
	const host = document.body.createDiv();
	const panel = new ChangesPanel(host, callbacks);
	return { host, panel };
}

const categoryButtons = (host: HTMLElement) =>
	Array.from(host.querySelectorAll<HTMLButtonElement>(".graph-insight-changes-category"));

describe("ChangesPanel (F-10)", () => {
	test("shows a skeleton while computing, then counts per category", () => {
		const { host, panel } = build();
		panel.setData(null);
		expect(host.querySelector(".graph-insight-changes-skeleton")).not.toBeNull();
		panel.setData(data());
		expect(host.querySelector(".graph-insight-changes-skeleton")).toBeNull();
		const counts = categoryButtons(host).map((b) => b.textContent);
		expect(counts[0]).toBe("New notes1");
		expect(counts[1]).toBe("Edited notes2");
	});

	test("without history the link categories are disabled and the empty state shows", () => {
		const { host, panel } = build();
		panel.setData(data({ hasHistory: false, addedLinks: [], growingHubs: [] }));
		const buttons = categoryButtons(host);
		expect(buttons[2].disabled).toBe(true);
		expect(buttons[4].disabled).toBe(true);
		expect(buttons[0].disabled).toBe(false);
		expect(host.textContent).toContain("History starts accumulating after this open");
	});

	test("selecting a category renders its rows; a note row opens the note", () => {
		const onOpenNote = vi.fn();
		const onCategorySelect = vi.fn();
		const { host, panel } = build({ onOpenNote, onCategorySelect });
		panel.setData(data());
		categoryButtons(host)[0].click();
		expect(onCategorySelect).toHaveBeenCalledWith("new-notes");
		panel.setState(7, "new-notes");
		const row = host.querySelector<HTMLButtonElement>(".graph-insight-changes-row")!;
		expect(row.textContent).toBe("a");
		row.click();
		expect(onOpenNote).toHaveBeenCalledWith("a.md");
	});

	test("a link row reports both ends to the host", () => {
		const onFocusLink = vi.fn();
		const { host, panel } = build({ onFocusLink });
		panel.setData(data());
		panel.setState(7, "added-links");
		host.querySelector<HTMLButtonElement>(".graph-insight-changes-row")!.click();
		expect(onFocusLink).toHaveBeenCalledWith({ fromPath: "a.md", toPath: "b.md" });
	});
});
