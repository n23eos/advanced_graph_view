// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import GraphInsightPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings/schema";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	Plugin: class {
		constructor(public app: unknown, public manifest: unknown) {}
		loadData = async () => ({ ...DEFAULT_SETTINGS, physicsDefaultsVersion: 1, viewPresetsVersion: 8 });
		saveData = vi.fn(async () => {});
		registerView(): void {}
		addSettingTab(): void {}
		addCommand(): void {}
		addRibbonIcon(): void {}
		registerEvent(): void {}
	},
	PluginSettingTab: class {},
	ItemView: class {},
	getLanguage: () => "en",
	debounce: (callback: () => void) => callback,
}));
vi.mock("./render/GraphRenderer", () => ({ GraphRenderer: class {} }));

function build() {
	const events = new Map<string, (tasks: { add(callback: () => Promise<unknown>): void }) => void>();
	const app = {
		vault: { configDir: "custom-config", adapter: { exists: async () => false }, on: vi.fn() },
		workspace: {
			on: (name: string, callback: (tasks: { add(callback: () => Promise<unknown>): void }) => void) => { events.set(name, callback); },
			getLeavesOfType: () => [],
		},
	};
	const plugin = new GraphInsightPlugin(app as unknown as App, { id: "graph-insight" } as PluginManifest);
	return { plugin, events };
}

describe("quit persistence", () => {
	test("awaits dirty usage and positions through the host quit task queue", async () => {
		const { plugin, events } = build();
		await plugin.onload();
		plugin.usageLog = { "a.md": { total: 1, days: {}, months: {}, years: {} } };
		Object.assign(plugin, { usageDirty: true });
		const saveUsage = vi.spyOn(plugin.dataStore, "saveUsage").mockResolvedValue(undefined);
		const flushPositions = vi.fn(async () => {});
		vi.spyOn(plugin, "getGraphView").mockReturnValue({ flushPositions } as never);
		const pending: Array<() => Promise<unknown>> = [];
		events.get("quit")?.({ add: (task) => pending.push(task) });
		expect(pending).toHaveLength(2);
		expect(saveUsage).not.toHaveBeenCalled();
		await Promise.all(pending.map((task) => task()));
		expect(saveUsage).toHaveBeenCalledWith(plugin.usageLog);
		expect(flushPositions).toHaveBeenCalledOnce();
	});
	test("quit without a loaded graph still flushes usage safely", async () => {
		const { plugin, events } = build();
		await plugin.onload();
		const pending: Array<() => Promise<unknown>> = [];
		events.get("quit")?.({ add: (task) => pending.push(task) });
		expect(pending).toHaveLength(1);
		await expect(pending[0]()).resolves.toBeUndefined();
	});
});
