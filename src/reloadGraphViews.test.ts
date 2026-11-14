import { describe, expect, test, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import GraphInsightPlugin from "./main";
import { GraphInsightView, GRAPH_INSIGHT_VIEW_TYPE } from "./view/GraphView";
import { LocalGraphView, LOCAL_GRAPH_VIEW_TYPE } from "./view/LocalGraphView";

vi.mock("obsidian", async (original) => ({
	...await original<typeof import("obsidian")>(),
	Plugin: class { constructor(public app: unknown, public manifest: unknown) {} },
	ItemView: class {}, PluginSettingTab: class {},
	debounce: (callback: () => void) => callback,
}));
vi.mock("./view/GraphView", () => ({ GRAPH_INSIGHT_VIEW_TYPE: "main-graph", GraphInsightView: class {} }));
vi.mock("./view/LocalGraphView", () => ({ LOCAL_GRAPH_VIEW_TYPE: "local-graph", LocalGraphView: class {} }));

function view(prototype: object, reload = vi.fn(async () => {})) {
	return Object.assign(Object.create(prototype) as object, { reloadFromSettings: reload });
}

function plugin(main: unknown[], local: unknown[]) {
	return new GraphInsightPlugin({ workspace: {
		getLeavesOfType: (type: string) => (type === GRAPH_INSIGHT_VIEW_TYPE ? main : type === LOCAL_GRAPH_VIEW_TYPE ? local : [])
			.map((item) => ({ view: item })),
	} } as unknown as App, {} as PluginManifest);
}

describe("reload all loaded graph views", () => {
	test("reloads every main and local view and ignores deferred placeholders", async () => {
		const first = view(GraphInsightView.prototype);
		const second = view(GraphInsightView.prototype);
		const local = view(LocalGraphView.prototype);
		const deferred = { reloadFromSettings: vi.fn() };
		await plugin([first, deferred, second], [local, {}]).reloadGraphViews();
		for (const loaded of [first, second, local]) expect(loaded.reloadFromSettings).toHaveBeenCalledOnce();
		expect(deferred.reloadFromSettings).not.toHaveBeenCalled();
	});
	test("waits for all pending reloads", async () => {
		let finish!: () => void;
		const pending = view(LocalGraphView.prototype, vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
		let done = false;
		const reloading = plugin([], [pending]).reloadGraphViews().then(() => { done = true; });
		await Promise.resolve();
		expect(done).toBe(false);
		finish();
		await reloading;
		expect(done).toBe(true);
	});
});
