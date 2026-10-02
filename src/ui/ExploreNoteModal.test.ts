// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { App } from "obsidian";
import { ExploreNoteModal } from "./ExploreNoteModal";
import { buildGraphModel } from "../data/GraphStore";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";

beforeAll(() => { installObsidianDom(); initI18n("en"); });

describe("Explore note picker host contract", () => {
	test("search text uses paths to distinguish duplicate note names", () => {
		const nodes = buildGraphModel(["one/Topic.md", "two/Topic.md"], {}, {}).nodes;
		const choose = vi.fn();
		const modal = new ExploreNoteModal({} as App, () => nodes, choose, vi.fn());
		expect(modal.getItems()).toEqual(nodes);
		expect(nodes.map((node) => modal.getItemText(node))).toEqual(["one/Topic.md", "two/Topic.md"]);
		modal.onChooseItem(nodes[1]);
		expect(choose).toHaveBeenCalledWith("two/Topic.md");
		expect(modal.inputEl.placeholder).toBe("Note name or path...");
		expect(modal.emptyStateText).toBe("No matching notes");
	});

	test("reads current choices and reports closing without choosing", () => {
		let nodes = buildGraphModel(["a.md", "b.md"], {}, {}).nodes;
		const choose = vi.fn();
		const dismiss = vi.fn();
		const modal = new ExploreNoteModal({} as App, () => nodes, choose, dismiss);
		nodes = nodes.slice(1);
		expect(modal.getItems()).toEqual(nodes);
		modal.close();
		expect(choose).not.toHaveBeenCalled();
		expect(dismiss).toHaveBeenCalledOnce();
	});
});
