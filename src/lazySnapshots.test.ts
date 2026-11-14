// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import GraphInsightPlugin from "./main";
import { PluginDataStore } from "./data/persistence";
import { DEFAULT_SETTINGS } from "./settings/schema";
import type { GraphModel } from "./data/GraphStore";
import type { GraphMetrics } from "./workers/MetricsClient";
import type { GraphSnapshot, SnapshotStore } from "./data/graphSnapshots";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	Plugin: class {
		constructor(public app: unknown, public manifest: unknown) {}
		loadData = async () => ({ ...DEFAULT_SETTINGS, physicsDefaultsVersion: 1, viewPresetsVersion: 8 });
		async saveData(): Promise<void> {}
		registerHoverLinkSource(): void {}
		registerView(): void {}
		addSettingTab(): void {}
		addCommand(): void {}
		addRibbonIcon(): void {}
		registerEvent(): void {}
	},
	PluginSettingTab: class {},
	ItemView: class {},
	getLanguage: () => "en",
	debounce: (callback: () => unknown) => {
		const debounced = () => {
			callback();
			return debounced;
		};
		debounced.cancel = () => debounced;
		debounced.run = () => callback();
		return debounced;
	},
}));
vi.mock("./render/GraphRenderer", () => ({ GraphRenderer: class {} }));

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const previousSnapshot: GraphSnapshot = {
	version: 1,
	capturedAt: NOW - 10 * DAY_MS,
	paths: ["old.md"],
	edges: [],
	pagerank: [1],
};
const previousStore: SnapshotStore = { version: 1, snapshots: [previousSnapshot] };

const model: GraphModel = {
	nodes: [{ id: 0, path: "new.md", name: "new", inCount: 0, outCount: 0, unresolvedCount: 0 }],
	edges: [],
	pathToId: new Map([["new.md", 0]]),
};
const metrics: GraphMetrics = {
	pagerank: new Float32Array([1]),
	community: new Int32Array([0]),
	communityCount: 1,
};

interface SnapshotLifecycle {
	ensureSnapshots(): Promise<void>;
	resetSnapshots(): Promise<void>;
}

function buildPlugin() {
	const app = {
		vault: {
			configDir: "custom-config",
			adapter: { exists: async () => false },
			on: vi.fn(),
		},
		workspace: {
			on: vi.fn(() => ({})),
			getLeavesOfType: () => [],
		},
	};
	return new GraphInsightPlugin(
		app as unknown as App,
		{ id: "graph-insight" } as PluginManifest
	);
}

function installStore(plugin: GraphInsightPlugin, loadSnapshots: () => Promise<SnapshotStore | null>) {
	const dataStore = {
		loadSnapshots: vi.fn(loadSnapshots),
		saveSnapshots: vi.fn(async (_store: SnapshotStore) => {}),
		removeSnapshots: vi.fn(async () => {}),
	};
	plugin.dataStore = dataStore as unknown as PluginDataStore;
	return dataStore;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("lazy snapshot persistence", () => {
	test("plugin startup does not read snapshots", async () => {
		const loadSnapshots = vi.spyOn(PluginDataStore.prototype, "loadSnapshots");
		const plugin = buildPlugin();
		await plugin.onload();
		expect(loadSnapshots).not.toHaveBeenCalled();
		expect(plugin.snapshotsLoaded).toBe(false);
	});

	test("concurrent consumers share one snapshot load", async () => {
		let finish!: (store: SnapshotStore) => void;
		const plugin = buildPlugin();
		const dataStore = installStore(plugin, () => new Promise((resolve) => { finish = resolve; }));
		const lifecycle = plugin as GraphInsightPlugin & SnapshotLifecycle;
		const first = lifecycle.ensureSnapshots();
		const second = lifecycle.ensureSnapshots();
		expect(plugin.snapshotsLoaded).toBe(false);
		expect(first).toBe(second);
		expect(dataStore.loadSnapshots).toHaveBeenCalledOnce();
		finish(previousStore);
		await Promise.all([first, second]);
		expect(plugin.snapshotStore).toEqual(previousStore);
		expect(plugin.snapshotsLoaded).toBe(true);
	});

	test("capture waits for loading and keeps prior snapshots", async () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		let finish!: (store: SnapshotStore) => void;
		const plugin = buildPlugin();
		const dataStore = installStore(plugin, () => new Promise((resolve) => { finish = resolve; }));
		const capture = plugin.maybeCaptureSnapshot(model, metrics);
		expect(dataStore.saveSnapshots).not.toHaveBeenCalled();
		finish(previousStore);
		await capture;
		const saved = dataStore.saveSnapshots.mock.calls[0]?.[0];
		expect(saved.snapshots.map((snapshot) => snapshot.paths[0])).toEqual(["old.md", "new.md"]);
	});

	test("a failed load cannot overwrite existing history", async () => {
		const plugin = buildPlugin();
		const dataStore = installStore(plugin, async () => { throw new Error("read failed"); });
		plugin.snapshotStore = previousStore;
		await expect(plugin.maybeCaptureSnapshot(model, metrics)).rejects.toThrow("read failed");
		expect(plugin.snapshotStore).toBe(previousStore);
		expect(dataStore.saveSnapshots).not.toHaveBeenCalled();
	});

	test("a failed snapshot load can be retried", async () => {
		const plugin = buildPlugin();
		let attempts = 0;
		const dataStore = installStore(plugin, async () => {
			if (attempts++ === 0) throw new Error("read failed");
			return previousStore;
		});
		const lifecycle = plugin as GraphInsightPlugin & SnapshotLifecycle;
		await expect(lifecycle.ensureSnapshots()).rejects.toThrow("read failed");
		expect(plugin.snapshotsLoaded).toBe(false);
		await expect(lifecycle.ensureSnapshots()).resolves.toBeUndefined();
		expect(dataStore.loadSnapshots).toHaveBeenCalledTimes(2);
		expect(dataStore.saveSnapshots).not.toHaveBeenCalled();
		expect(plugin.snapshotStore).toEqual(previousStore);
		expect(plugin.snapshotsLoaded).toBe(true);
	});

	test("reset invalidates a snapshot load already in progress", async () => {
		let finish!: (store: SnapshotStore) => void;
		const plugin = buildPlugin();
		const dataStore = installStore(plugin, () => new Promise((resolve) => { finish = resolve; }));
		const lifecycle = plugin as GraphInsightPlugin & SnapshotLifecycle;
		const loading = lifecycle.ensureSnapshots();
		const reset = lifecycle.resetSnapshots();
		expect(plugin.snapshotsLoaded).toBe(true);
		finish(previousStore);
		await Promise.all([loading, reset]);
		expect(plugin.snapshotStore.snapshots).toEqual([]);
		expect(dataStore.removeSnapshots).toHaveBeenCalledOnce();
	});

	test("reset removes snapshots after an in-flight capture finishes writing", async () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		let finishSave!: () => void;
		const plugin = buildPlugin();
		const dataStore = installStore(plugin, async () => ({ version: 1, snapshots: [] }));
		dataStore.saveSnapshots.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
		const lifecycle = plugin as GraphInsightPlugin & SnapshotLifecycle;
		const capture = plugin.maybeCaptureSnapshot(model, metrics);
		await vi.waitFor(() => expect(dataStore.saveSnapshots).toHaveBeenCalledOnce());
		const reset = lifecycle.resetSnapshots();
		expect(dataStore.removeSnapshots).not.toHaveBeenCalled();
		finishSave();
		await Promise.all([capture, reset]);
		expect(dataStore.removeSnapshots).toHaveBeenCalledOnce();
		expect(plugin.snapshotStore.snapshots).toEqual([]);
	});
});
