// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings/schema";
import type { CameraState } from "./workspaceState";
import { GraphInsightView } from "./GraphView";
import { installObsidianDom } from "../test/obsidianDom";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		leaf: unknown;
		contentEl = document.body;
		containerEl = document.body;
		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.leaf = leaf;
		}
	},
	Notice: class { hide(): void {} },
	debounce: (callback: () => void) => {
		const debounced = () => callback();
		debounced.cancel = vi.fn();
		return debounced;
	},
}));

vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

const camera: CameraState = {
	viewport: { centerX: 12, centerY: 34, scale: 1.4, referenceScale: 0.7 },
	camera3d: {
		position: { x: 1, y: 2, z: -300 },
		pivot: { x: 4, y: 5, z: 6 },
		yaw: 0.3,
		pitch: -0.2,
	},
};

interface Internals {
	renderer: {
		getCameraState(): CameraState | null;
		restoreCameraState(state: CameraState): void;
	} | null;
	model: object | null;
	autoFit: { request(): void; isPending(): boolean };
	contentIndex: Map<string, Set<string>>;
	recomputeVisual(): void;
	searchBar: { applyQuery(query: string): void; setUiState(state: unknown): void } | null;
	viewWindow: Window | null;
	handleCameraChanged(): void;
	commitSearchQuery(query: string): void;
	clearSearchQuery(): void;
	clearHardQueryForTask(): void;
	resetViewState(): Promise<void>;
	hardQueryText: string;
	teardown(): Promise<void>;
	onOpen(): Promise<void>;
	closing: boolean;
	applyPendingWorkspaceCamera(): boolean;
}

function harness(files: Array<{ path: string }> = []) {
	const requestSaveLayout = vi.fn(async () => {});
	const app = {
		workspace: { requestSaveLayout },
		metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: vi.fn(async (file: { path: string }): Promise<string> => (
				file.path === "match.md" ? "A Needle here" : "other"
			)),
		},
	};
	const plugin = {
		settings: structuredClone(DEFAULT_SETTINGS),
		usageLog: {},
		dataStore: { loadPositions: vi.fn(async () => null), savePositions: vi.fn(async () => {}) },
		saveChipFilter: vi.fn(async () => {}),
		flushSettings: vi.fn(async () => {}),
	};
	const view = new GraphInsightView(
		{ app } as unknown as WorkspaceLeaf,
		plugin as unknown as ConstructorParameters<typeof GraphInsightView>[1]
	);
	const internal = view as unknown as Internals;
	internal.recomputeVisual = vi.fn();
	return { app, requestSaveLayout, view, internal };
}

beforeAll(() => installObsidianDom());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("GraphInsightView workspace state", () => {
	test("applies a late camera and query independently and returns the current per-leaf state", async () => {
		const { view, internal } = harness();
		const restoreCameraState = vi.fn();
		internal.renderer = { getCameraState: () => camera, restoreCameraState };
		internal.model = {};
		internal.autoFit.request();

		await view.setState({ version: 1, camera, hardQuery: "tag:#work" }, { history: false });

		expect(restoreCameraState).toHaveBeenCalledExactlyOnceWith(camera);
		expect(internal.autoFit.isPending()).toBe(false);
		expect(view.getState()).toEqual({ version: 1, camera, hardQuery: "tag:#work" });
	});

	test("keeps normal auto-fit when only the query is valid", async () => {
		const { view, internal } = harness();
		internal.autoFit.request();

		await view.setState({
			version: 1,
			camera: { ...camera, viewport: { ...camera.viewport, scale: 0 } },
			hardQuery: "tag:#work",
		}, { history: false });

		expect(internal.autoFit.isPending()).toBe(true);
		expect(view.getState()).toEqual({ version: 1, hardQuery: "tag:#work" });
	});

	test("keeps workspace state isolated between graph leaves", async () => {
		const first = harness().view;
		const second = harness().view;

		await first.setState({ version: 1, hardQuery: "tag:#first" }, { history: false });
		await second.setState({ version: 1, hardQuery: "tag:#second" }, { history: false });

		expect(first.getState()).toEqual({ version: 1, hardQuery: "tag:#first" });
		expect(second.getState()).toEqual({ version: 1, hardQuery: "tag:#second" });
	});

	test("indexes a restored content query after the model is ready", async () => {
		const files = [{ path: "match.md" }, { path: "miss.md" }];
		const { view, internal } = harness(files);
		internal.model = {};

		await view.setState({ version: 1, hardQuery: "content:needle" }, { history: false });

		expect(internal.contentIndex.get("needle")).toEqual(new Set(["match.md"]));
	});

	test("waits for restored content indexing even when the search UI is already mounted", async () => {
		const files = [{ path: "match.md" }];
		const { app, view, internal } = harness(files);
		internal.model = {};
		internal.searchBar = {
			applyQuery: (query) => internal.commitSearchQuery(query),
			setUiState: vi.fn(),
		};
		let finishRead!: () => void;
		app.vault.cachedRead = vi.fn((_file: { path: string }) => new Promise<string>((resolve) => {
			finishRead = () => resolve("needle");
		}));

		let restored = false;
		const restoring = view
			.setState({ version: 1, hardQuery: "content:needle" }, { history: false })
			.then(() => { restored = true; });
		await vi.waitFor(() => expect(app.vault.cachedRead).toHaveBeenCalledOnce());
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		expect(restored).toBe(false);

		finishRead();
		await restoring;
		expect(internal.contentIndex.get("needle")).toEqual(new Set(["match.md"]));
	});

	test("discards a cancelled content scan so reopen performs a complete rescan", async () => {
		const files = [{ path: "match.md" }];
		const { app, view, internal } = harness(files);
		internal.model = {};
		let finishFirstRead!: () => void;
		app.vault.cachedRead = vi.fn()
			.mockImplementationOnce((_file: { path: string }) => new Promise<string>((resolve) => {
				finishFirstRead = () => resolve("needle");
			}))
			.mockResolvedValue("needle");

		const firstRestore = view.setState(
			{ version: 1, hardQuery: "content:needle" },
			{ history: false }
		);
		await vi.waitFor(() => expect(app.vault.cachedRead).toHaveBeenCalledOnce());
		await view.onClose();
		finishFirstRead();
		await firstRestore;
		expect(internal.contentIndex.has("needle")).toBe(false);

		internal.closing = false;
		internal.model = {};
		await view.setState({ version: 1, hardQuery: "content:needle" }, { history: false });
		expect(app.vault.cachedRead).toHaveBeenCalledTimes(2);
		expect(internal.contentIndex.get("needle")).toEqual(new Set(["match.md"]));
	});

	test("trails camera save requests independently for each leaf", async () => {
		vi.useFakeTimers();
		const first = harness();
		const second = harness();
		first.internal.viewWindow = window;
		second.internal.viewWindow = window;

		first.internal.handleCameraChanged();
		first.internal.handleCameraChanged();
		second.internal.handleCameraChanged();
		await vi.advanceTimersByTimeAsync(299);
		expect(first.requestSaveLayout).not.toHaveBeenCalled();
		expect(second.requestSaveLayout).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(first.requestSaveLayout).toHaveBeenCalledOnce();
		expect(second.requestSaveLayout).toHaveBeenCalledOnce();
	});

	test("requests persistence for user query commit and clear but not for workspace restore", async () => {
		vi.useFakeTimers();
		const { view, internal, requestSaveLayout } = harness();
		internal.viewWindow = window;

		await view.setState({ version: 1, hardQuery: "tag:#restored" }, { history: false });
		await vi.advanceTimersByTimeAsync(300);
		expect(requestSaveLayout).not.toHaveBeenCalled();

		internal.commitSearchQuery("tag:#work");
		await vi.advanceTimersByTimeAsync(300);
		expect(requestSaveLayout).toHaveBeenCalledOnce();
		expect(view.getState()).toEqual({ version: 1, hardQuery: "tag:#work" });

		internal.clearSearchQuery();
		await vi.advanceTimersByTimeAsync(300);
		expect(requestSaveLayout).toHaveBeenCalledTimes(2);
		expect(view.getState()).toEqual({ version: 1, hardQuery: "" });
	});

	test("restores the initial camera after 3D mode setup and leaves settle auto-fit cancelled", async () => {
		const { view, internal } = harness();
		const order: string[] = [];
		const renderer = {
			currentPositions: null,
			getCameraState: () => camera,
			restoreCameraState: vi.fn(() => order.push("restore")),
			setModel: vi.fn(),
			setPinned: vi.fn(),
			setLabelOptions: vi.fn(),
			setEdgeStyle: vi.fn(),
		};
		Object.assign(internal, {
			renderer,
			layout: { start: vi.fn(), pin: vi.fn() },
			metricsClient: { compute: vi.fn() },
			apply3D: vi.fn(() => order.push("apply3D")),
			applyPhysics: vi.fn(),
			applyLayoutRule: vi.fn(),
			applyEncoding: vi.fn(),
			applyOverlays: vi.fn(),
			refreshTimelineData: vi.fn(),
			syncTimelineAndTrail: vi.fn(),
			updateEmptyState: vi.fn(),
			restorePins: vi.fn(),
		});

		await view.setState({ version: 1, camera }, { history: false });
		expect(renderer.restoreCameraState).not.toHaveBeenCalled();
		await (internal as unknown as { rebuildGraph(): Promise<void> }).rebuildGraph();

		expect(order).toEqual(["apply3D", "restore"]);
		expect(internal.autoFit.isPending()).toBe(false);
	});

	test("keeps the current camera and query across an internal reopen", async () => {
		const { view, internal } = harness();
		internal.model = {};
		internal.renderer = { getCameraState: () => camera, restoreCameraState: vi.fn() };
		internal.commitSearchQuery("tag:#before-reopen");
		internal.teardown = vi.fn(async () => {
			internal.renderer = null;
			internal.model = null;
			internal.hardQueryText = "";
		});
		internal.onOpen = vi.fn(async () => {});

		await view.reloadFromSettings();

		expect(view.getState()).toEqual({ version: 1, camera, hardQuery: "tag:#before-reopen" });
	});

	test("a newer external state wins while an internal reopen is waiting for teardown", async () => {
		const oldCamera = camera;
		const newCamera: CameraState = {
			...camera,
			viewport: { ...camera.viewport, centerX: 999 },
		};
		const { view, internal } = harness();
		internal.model = {};
		const restoreOldRenderer = vi.fn();
		internal.renderer = { getCameraState: () => oldCamera, restoreCameraState: restoreOldRenderer };
		const restoreNewRenderer = vi.fn();
		let release!: () => void;
		const teardown = vi.fn(async () => {
			internal.closing = true;
			await new Promise<void>((resolve) => { release = resolve; });
			internal.renderer = null;
			internal.model = null;
		});
		internal.teardown = teardown;
		internal.onOpen = vi.fn(async () => {
			internal.closing = false;
			internal.renderer = { getCameraState: () => newCamera, restoreCameraState: restoreNewRenderer };
			internal.model = {};
			internal.applyPendingWorkspaceCamera();
		});

		const reopening = view.reloadFromSettings();
		await view.setState({ version: 1, camera: newCamera, hardQuery: "tag:#new" }, { history: false });
		await vi.waitFor(() => expect(teardown).toHaveBeenCalledOnce());
		release();
		await reopening;

		expect(restoreOldRenderer).not.toHaveBeenCalled();
		expect(restoreNewRenderer).toHaveBeenCalledExactlyOnceWith(newCamera);
		expect(view.getState()).toEqual({ version: 1, camera: newCamera, hardQuery: "tag:#new" });
	});

	test("requests persistence when a task clears the query and when view state resets", async () => {
		vi.useFakeTimers();
		const { internal, requestSaveLayout } = harness();
		internal.viewWindow = window;
		internal.commitSearchQuery("tag:#work");
		await vi.advanceTimersByTimeAsync(300);
		requestSaveLayout.mockClear();

		internal.clearHardQueryForTask();
		await vi.advanceTimersByTimeAsync(300);
		expect(requestSaveLayout).toHaveBeenCalledOnce();

		requestSaveLayout.mockClear();
		await internal.resetViewState();
		await vi.advanceTimersByTimeAsync(300);
		expect(requestSaveLayout).toHaveBeenCalledOnce();
	});
});
