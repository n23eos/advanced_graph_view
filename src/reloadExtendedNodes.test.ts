import { expect, test, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import GraphInsightPlugin from "./main";
import { InsightsView, INSIGHTS_VIEW_TYPE } from "./view/InsightsView";
vi.mock("obsidian", async original => ({
	...await original<object>(), Plugin: class { constructor(public app: unknown) {} },
	ItemView: class {}, PluginSettingTab: class {}, debounce: (callback: () => void) => callback,
}));
vi.mock("./view/GraphView", () => ({ GRAPH_INSIGHT_VIEW_TYPE: "main-graph", GraphInsightView: class {} }));
vi.mock("./view/LocalGraphView", () => ({ LOCAL_GRAPH_VIEW_TYPE: "local-graph", LocalGraphView: class {} }));
test("scope changes also refresh an already open Insights dashboard", async () => {
	const reloadFromSettings = vi.fn(async () => {});
	const view = Object.assign(Object.create(InsightsView.prototype) as object, { reloadFromSettings });
	const app = { workspace: { getLeavesOfType: (type: string) => type === INSIGHTS_VIEW_TYPE ? [{ view }] : [] } };
	const plugin = new GraphInsightPlugin(app as unknown as App, {} as PluginManifest);
	await plugin.reloadGraphViews();
	expect(reloadFromSettings).toHaveBeenCalledOnce();
});
