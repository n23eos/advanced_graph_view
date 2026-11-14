// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import type { App, PluginManifest, WorkspaceLeaf } from "obsidian";
import GraphInsightPlugin from "../main";
import { GraphInsightView } from "../view/GraphView";
import { DEFAULT_SETTINGS, type GraphInsightSettings } from "./schema";
import type { PanelState } from "../ui/ControlPanel";

const host = vi.hoisted(() => ({
	saveData: vi.fn<(data: unknown) => Promise<void>>(async () => {}),
}));

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	Plugin: class {
		constructor(public app: unknown, public manifest: unknown) {}
		loadData = async () => ({ ...DEFAULT_SETTINGS, physicsDefaultsVersion: 1, viewPresetsVersion: 8 });
		async saveData(data: unknown): Promise<void> { await host.saveData(data); }
		registerView(): void {}
		addSettingTab(): void {}
		addCommand(): void {}
		addRibbonIcon(): void {}
		registerEvent(): void {}
	},
	PluginSettingTab: class {},
	ItemView: class {
		app: unknown;
		constructor(leaf: { app: unknown }) { this.app = leaf.app; }
	},
	getLanguage: () => "en",
	debounce: (callback: (...args: unknown[]) => unknown, delay = 0) => {
		let timer: number | null = null;
		let args: unknown[] = [];
		const debounced = (...next: unknown[]) => {
			args = next;
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = null;
				callback(...args);
			}, delay);
			return debounced;
		};
		debounced.cancel = () => {
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
			return debounced;
		};
		debounced.run = () => {
			if (timer === null) return undefined;
			window.clearTimeout(timer);
			timer = null;
			return callback(...args);
		};
		return debounced;
	},
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

function buildApp() {
	const events = new Map<string, (tasks: { add(callback: () => Promise<unknown>): void }) => void>();
	const app = {
		vault: {
			configDir: "custom-config",
			adapter: { exists: async () => false },
			on: vi.fn(),
		},
		workspace: {
			on: (name: string, callback: (tasks: { add(callback: () => Promise<unknown>): void }) => void) => {
				events.set(name, callback);
			},
			getLeavesOfType: () => [],
		},
	};
	return { app, events };
}

function buildPlugin() {
	const { app, events } = buildApp();
	const plugin = new GraphInsightPlugin(
		app as unknown as App,
		{ id: "graph-insight" } as PluginManifest
	);
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	return { plugin, events };
}

function panel(nodeScale: number): PanelState {
	return { ...structuredClone(DEFAULT_SETTINGS.panel), nodeScale };
}

afterEach(() => {
	vi.useRealTimers();
	host.saveData.mockReset();
	host.saveData.mockResolvedValue(undefined);
});

describe("panel settings persistence", () => {
	test("updates memory synchronously and coalesces twenty changes into one write after 400 ms", async () => {
		vi.useFakeTimers();
		const { plugin } = buildPlugin();
		const writes: Promise<void>[] = [];
		for (let index = 1; index <= 20; index++) {
			const next = panel(index);
			writes.push(plugin.savePanelState(next));
			expect(plugin.settings.panel).toBe(next);
		}
		await Promise.all(writes);
		expect(host.saveData).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(399);
		expect(host.saveData).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(host.saveData).toHaveBeenCalledOnce();
		const saved = host.saveData.mock.calls[0]?.[0] as GraphInsightSettings;
		expect(saved.panel.nodeScale).toBe(20);
	});

	test("flushSettings writes a pending panel change immediately and cancels the timer", async () => {
		vi.useFakeTimers();
		const { plugin } = buildPlugin();
		await plugin.savePanelState(panel(3));
		await plugin.flushSettings();
		expect(host.saveData).toHaveBeenCalledOnce();
		const saved = host.saveData.mock.calls[0]?.[0] as GraphInsightSettings;
		expect(saved.panel.nodeScale).toBe(3);
		await vi.advanceTimersByTimeAsync(400);
		expect(host.saveData).toHaveBeenCalledOnce();
	});

	test("serializes an immediate settings save behind an in-flight panel write", async () => {
		vi.useFakeTimers();
		const completions: Array<() => void> = [];
		host.saveData.mockImplementation(() => new Promise<void>((resolve) => completions.push(resolve)));
		const { plugin } = buildPlugin();
		const panelSave = plugin.savePanelState(panel(4));
		await vi.advanceTimersByTimeAsync(400);
		expect(host.saveData).toHaveBeenCalledOnce();
		const modeSave = plugin.savePanelMode("expert");
		expect(host.saveData).toHaveBeenCalledOnce();
		completions[0]();
		await Promise.resolve();
		await Promise.resolve();
		expect(host.saveData).toHaveBeenCalledTimes(2);
		const saved = host.saveData.mock.calls[1]?.[0] as GraphInsightSettings;
		expect(saved.panel.nodeScale).toBe(4);
		expect(saved.panelMode).toBe("expert");
		completions[1]();
		await Promise.all([panelSave, modeSave]);
	});

	test("a failed flush keeps panel settings dirty for a retry", async () => {
		const { plugin } = buildPlugin();
		host.saveData
			.mockRejectedValueOnce(new Error("disk unavailable"))
			.mockResolvedValueOnce(undefined);
		await plugin.savePanelState(panel(5));
		await expect(plugin.flushSettings()).rejects.toThrow("disk unavailable");
		await expect(plugin.flushSettings()).resolves.toBeUndefined();
		expect(host.saveData).toHaveBeenCalledTimes(2);
	});

	test("quit and unload invoke the settings flush", async () => {
		const { plugin, events } = buildPlugin();
		const flushSettings = vi.fn(async () => {});
		Object.assign(plugin, { flushSettings });
		await plugin.onload();
		const pending: Array<() => Promise<unknown>> = [];
		events.get("quit")?.({ add: (task) => pending.push(task) });
		await Promise.all(pending.map((task) => task()));
		expect(flushSettings).toHaveBeenCalledOnce();
		plugin.onunload();
		expect(flushSettings).toHaveBeenCalledTimes(2);
	});

	test("closing a graph view flushes pending panel settings", async () => {
		const flushSettings = vi.fn(async () => {});
		const plugin = {
			dataStore: { savePositions: vi.fn(async () => {}) },
			flushSettings,
		};
		const view = new GraphInsightView(
			{ app: {} } as unknown as WorkspaceLeaf,
			plugin as never
		);
		await view.onClose();
		expect(flushSettings).toHaveBeenCalledOnce();
	});
});
