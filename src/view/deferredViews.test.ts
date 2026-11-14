// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import GraphInsightPlugin from "../main";
import { GraphInsightView } from "./GraphView";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	Plugin: class {},
	PluginSettingTab: class {},
	ItemView: class {},
	debounce: (callback: () => void) => callback,
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

function select(views: unknown[]) {
	return GraphInsightPlugin.prototype.getGraphView.call({
		app: { workspace: { getLeavesOfType: () => views.map((view) => ({ view })) } },
	} as unknown as GraphInsightPlugin);
}

describe("graph command target", () => {
	test("returns null without a graph leaf", () => {
		expect(select([])).toBeNull();
	});
	test("does not expose a deferred view to graph commands", () => {
		expect(select([{ getViewType: () => "graph-insight-view" }])).toBeNull();
	});
	test("returns a loaded graph instance", () => {
		const view: unknown = Object.create(GraphInsightView.prototype);
		expect(select([view])).toBe(view);
	});
	test("finds a loaded view after a deferred one", () => {
		const view: unknown = Object.create(GraphInsightView.prototype);
		expect(select([{}, view])).toBe(view);
	});
});
