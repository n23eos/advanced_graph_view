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

describe("export command availability", () => {
	test.each([
		["export-png", "exportPngFile"],
		["export-json", "exportJsonFile"],
		["export-gexf", "exportGexfFile"],
	] as const)("%s requires a loaded graph and only exports on execution", async (id, method) => {
		const { plugin } = build();
		const commands = vi.spyOn(plugin, "addCommand");
		await plugin.onload();
		const command = commands.mock.calls.find(([item]) => item.id === id)?.[0];
		expect(command?.checkCallback).toBeTypeOf("function");
		expect(command?.checkCallback?.(true)).toBe(false);
		expect(command?.checkCallback?.(false)).toBe(false);
		const exportFile = vi.fn();
		vi.spyOn(plugin, "getGraphView").mockReturnValue({ [method]: exportFile } as never);
		expect(command?.checkCallback?.(true)).toBe(true);
		expect(exportFile).not.toHaveBeenCalled();
		expect(command?.checkCallback?.(false)).toBe(true);
		expect(exportFile).toHaveBeenCalledOnce();
	});
});

describe("in-flight usage writes", () => {
	test("quit waits for an already started usage write even when dirty is cleared", async () => {
		const { plugin, events } = build();
		await plugin.onload();
		let complete!: () => void;
		vi.spyOn(plugin.dataStore, "saveUsage").mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
		const internal = plugin as unknown as { usageDirty: boolean; flushUsage(): Promise<void> };
		internal.usageDirty = true;
		const first = internal.flushUsage();
		const pending: Array<() => Promise<unknown>> = [];
		events.get("quit")!({ add: (task) => pending.push(task) });
		let done = false;
		const quit = Promise.all(pending.map((task) => task())).then(() => { done = true; });
		await Promise.resolve();
		await Promise.resolve();
		expect(done).toBe(false);
		complete();
		await Promise.all([first, quit]);
		expect(done).toBe(true);
	});
	test("a new usage update cannot race an older write", async () => {
		const { plugin } = build();
		await plugin.onload();
		const completions: Array<() => void> = [];
		const write = vi.spyOn(plugin.dataStore, "saveUsage").mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
		const internal = plugin as unknown as { usageDirty: boolean; flushUsage(): Promise<void> };
		internal.usageDirty = true;
		const first = internal.flushUsage();
		plugin.usageLog = { "a.md": { total: 2, days: {}, months: {}, years: {} } };
		internal.usageDirty = true;
		const last = internal.flushUsage();
		expect(write).toHaveBeenCalledTimes(1);
		completions[0]();
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
		expect(write).toHaveBeenLastCalledWith(plugin.usageLog);
		completions[1]();
		await Promise.all([first, last]);
	});
});
