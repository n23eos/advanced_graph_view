import { describe, expect, test, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import GraphInsightPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings/schema";
import { GraphInsightView, GRAPH_INSIGHT_VIEW_TYPE } from "./view/GraphView";
import { LocalGraphView, LOCAL_GRAPH_VIEW_TYPE } from "./view/LocalGraphView";

vi.mock("obsidian", async (original) => ({
	...await original<typeof import("obsidian")>(),
	Plugin: class { constructor(public app: unknown, public manifest: unknown) {} },
	ItemView: class {},
	PluginSettingTab: class {},
	debounce: (callback: () => void) => {
		const debounced = () => {
			callback();
			return debounced;
		};
		debounced.cancel = () => debounced;
		debounced.run = () => callback();
		return debounced;
	},
}));

vi.mock("./view/GraphView", () => ({
	GRAPH_INSIGHT_VIEW_TYPE: "main-graph",
	GraphInsightView: class {},
}));

vi.mock("./view/LocalGraphView", () => ({
	LOCAL_GRAPH_VIEW_TYPE: "local-graph",
	LocalGraphView: class {},
}));

function loaded(prototype: object, reloadFromSettings: () => Promise<void>) {
	return Object.assign(Object.create(prototype) as object, { reloadFromSettings });
}

function buildPlugin(main: unknown[], local: unknown[]): GraphInsightPlugin {
	const app = {
		workspace: {
			getLeavesOfType: (type: string) => (
				type === GRAPH_INSIGHT_VIEW_TYPE ? main : type === LOCAL_GRAPH_VIEW_TYPE ? local : []
			).map((item) => ({ view: item })),
		},
	};
	return new GraphInsightPlugin(app as unknown as App, {} as PluginManifest);
}

function deferred(): { promise: Promise<void>; resolve(): void } {
	let resolve!: () => void;
	return {
		promise: new Promise<void>((done) => { resolve = done; }),
		resolve: () => resolve(),
	};
}

describe("safe graph view reloads", () => {
	test("replaceSettings reloads every main and local view", async () => {
		const firstReload = vi.fn(async () => {});
		const secondReload = vi.fn(async () => {});
		const localReload = vi.fn(async () => {});
		const plugin = buildPlugin([
			loaded(GraphInsightView.prototype, firstReload),
			loaded(GraphInsightView.prototype, secondReload),
		], [loaded(LocalGraphView.prototype, localReload)]);
		vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);

		await plugin.replaceSettings(structuredClone(DEFAULT_SETTINGS));

		expect(firstReload).toHaveBeenCalledOnce();
		expect(secondReload).toHaveBeenCalledOnce();
		expect(localReload).toHaveBeenCalledOnce();
	});

	test("reloads views one at a time", async () => {
		const first = deferred();
		const firstReload = vi.fn(() => first.promise);
		const secondReload = vi.fn(async () => {});
		const plugin = buildPlugin([
			loaded(GraphInsightView.prototype, firstReload),
			loaded(GraphInsightView.prototype, secondReload),
		], []);

		const reloading = plugin.reloadGraphViews();
		await Promise.resolve();
		expect(firstReload).toHaveBeenCalledOnce();
		expect(secondReload).not.toHaveBeenCalled();

		first.resolve();
		await reloading;
		expect(secondReload).toHaveBeenCalledOnce();
	});

	test("serializes overlapping reload requests", async () => {
		const first = deferred();
		const reload = vi.fn()
			.mockImplementationOnce(() => first.promise)
			.mockResolvedValueOnce(undefined);
		const plugin = buildPlugin([loaded(GraphInsightView.prototype, reload)], []);

		const firstRequest = plugin.reloadGraphViews();
		const secondRequest = plugin.reloadGraphViews();
		await Promise.resolve();
		expect(reload).toHaveBeenCalledOnce();

		first.resolve();
		await Promise.all([firstRequest, secondRequest]);
		expect(reload).toHaveBeenCalledTimes(2);
	});

	test("surfaces a failure and keeps later requests usable", async () => {
		const failure = new Error("reload failed");
		const reload = vi.fn()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(undefined);
		const plugin = buildPlugin([loaded(GraphInsightView.prototype, reload)], []);

		await expect(plugin.reloadGraphViews()).rejects.toBe(failure);
		await expect(plugin.reloadGraphViews()).resolves.toBeUndefined();
		expect(reload).toHaveBeenCalledTimes(2);
	});

	test("continues serial reloads before surfacing the first failure", async () => {
		const failure = new Error("first failed");
		const firstReload = vi.fn(async () => { throw failure; });
		const secondReload = vi.fn(async () => {});
		const plugin = buildPlugin([
			loaded(GraphInsightView.prototype, firstReload),
			loaded(GraphInsightView.prototype, secondReload),
		], []);

		await expect(plugin.reloadGraphViews()).rejects.toBe(failure);
		expect(secondReload).toHaveBeenCalledOnce();
	});
});
