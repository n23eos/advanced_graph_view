// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { initI18n } from "../i18n";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { installObsidianDom } from "../test/obsidianDom";
import { GraphInsightView } from "./GraphView";
import { LocalGraphView } from "./LocalGraphView";

const state = vi.hoisted(() => ({
	renderers: [] as Array<{
		destroy: ReturnType<typeof vi.fn>;
		host: HTMLElement | null;
		ownerWindow: Window | null;
	}>,
}));

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		leaf: unknown;
		contentEl = document.body.createDiv();
		containerEl = this.contentEl;
		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.leaf = leaf;
		}
	},
	debounce: (callback: () => void) => {
		const debounced = () => {
			callback();
			return debounced;
		};
		debounced.cancel = vi.fn(() => debounced);
		debounced.run = () => callback();
		return debounced;
	},
}));

vi.mock("../render/GraphRenderer", () => ({
	GraphRenderer: class {
		currentPositions = null;
		destroy = vi.fn();
		host: HTMLElement | null = null;
		ownerWindow: Window | null = null;
		constructor() { state.renderers.push(this); }
		init(host: HTMLElement): Promise<void> {
			this.host = host;
			this.ownerWindow = host.ownerDocument.defaultView;
			return Promise.resolve();
		}
		pause(): void {}
		resume(): void {}
		resize(): void {}
		setModel(): void {}
		setPinned(): void {}
		setLabelOptions(): void {}
		setEdgeStyle(): void {}
		set3DMode(): void {}
		setCameraFocal(): void {}
		setVisualStyle(): void {}
		applyEncoding(): void {}
		setHighlightMask(): void {}
		setAlphaFactors(): void {}
		drawClusterHulls(): void {}
		setSessionTrail(): void {}
		setPathHighlight(): void {}
		fitAll(): void {}
		resetCamera(): void {}
		refreshThemeColors(): void {}
	},
}));

vi.mock("../workers/LayoutClient", () => ({
	LayoutClient: class {
		start(): void {}
		setParams(): void {}
		stop(): void {}
	},
}));
vi.mock("../workers/MetricsClient", () => ({
	MetricsClient: class {
		compute(): void {}
		stop(): void {}
	},
}));

interface EventRef {
	callback: (...args: unknown[]) => void;
}

function eventSource() {
	const refs = new Set<EventRef>();
	return {
		on: vi.fn((_name: string, callback: EventRef["callback"]) => {
			const ref = { callback };
			refs.add(ref);
			return ref;
		}),
		offref: vi.fn((ref: EventRef) => refs.delete(ref)),
	};
}

function appHarness() {
	return {
		workspace: {
			...eventSource(),
			getActiveFile: () => null,
			getActiveViewOfType: () => null,
		},
		metadataCache: {
			...eventSource(),
			resolvedLinks: {},
			unresolvedLinks: {},
		},
		vault: {
			...eventSource(),
			getMarkdownFiles: () => [],
		},
	};
}

function migrationHarness(element: HTMLElement) {
	const listeners = new Set<(win: Window) => void>();
	const cleanups: Array<ReturnType<typeof vi.fn>> = [];
	Object.defineProperty(element, "onWindowMigrated", {
		configurable: true,
		value: (listener: (win: Window) => void) => {
			listeners.add(listener);
			const cleanup = vi.fn(() => listeners.delete(listener));
			cleanups.push(cleanup);
			return cleanup;
		},
	});
	return {
		cleanups,
		listeners,
		emitQueuedTwice(win: Window): void {
			const queued = [...listeners];
			for (const listener of queued) {
				listener(win);
				listener(win);
			}
		},
	};
}

function secondWindow(): Window {
	const iframe = document.body.createEl("iframe");
	const win = iframe.contentWindow!;
	installObsidianDom(win);
	return win;
}

function keyDownEvent(ownerWindow: Window): KeyboardEvent {
	const WindowGlobal = ownerWindow as Window & typeof window;
	return new WindowGlobal.KeyboardEvent("keydown", { key: "Escape" });
}

function mainView(flushSettings: () => Promise<void> = async () => {}) {
	const app = appHarness();
	const plugin = {
		settings: structuredClone(DEFAULT_SETTINGS),
		flushSettings: vi.fn(flushSettings),
		showOnboarding: vi.fn(),
		sessionTrail: [],
	};
	const view = new GraphInsightView(
		{ app } as unknown as WorkspaceLeaf,
		plugin as unknown as ConstructorParameters<typeof GraphInsightView>[1],
	);
	const internal = view as unknown as {
		buildPanel(): { setViewPresets(): void; destroy(): void };
		rebuildGraph(): Promise<void>;
	};
	internal.buildPanel = () => ({ setViewPresets: vi.fn(), destroy: vi.fn() });
	internal.rebuildGraph = vi.fn(async () => {});
	return { plugin, view };
}

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

beforeEach(() => {
	state.renderers.length = 0;
});

afterEach(() => {
	document.body.empty();
	vi.restoreAllMocks();
});

describe("view window migration", () => {
	test("reopens the main graph once in the new window and moves keyboard handling", async () => {
		let finishFlush!: () => void;
		let flushCalls = 0;
		const flushSettings = vi.fn(() => {
			flushCalls++;
			if (flushCalls > 1) return Promise.resolve();
			return new Promise<void>((resolve) => { finishFlush = resolve; });
		});
		const app = appHarness();
		const plugin = {
			settings: structuredClone(DEFAULT_SETTINGS),
			flushSettings,
			showOnboarding: vi.fn(),
			sessionTrail: [],
		};
		const view = new GraphInsightView(
			{ app } as unknown as WorkspaceLeaf,
			plugin as unknown as ConstructorParameters<typeof GraphInsightView>[1],
		);
		const internal = view as unknown as {
			buildPanel(): { setViewPresets(): void; destroy(): void };
			rebuildGraph(): Promise<void>;
			handleKeyDown(event: KeyboardEvent): void;
		};
		internal.buildPanel = () => ({ setViewPresets: vi.fn(), destroy: vi.fn() });
		internal.rebuildGraph = vi.fn(async () => {});
		const keyDown = vi.spyOn(internal, "handleKeyDown").mockImplementation(() => {});
		const oldWindow = view.contentEl.ownerDocument.defaultView!;
		const oldCancelFrame = vi.spyOn(oldWindow, "cancelAnimationFrame");
		vi.spyOn(oldWindow, "requestAnimationFrame").mockReturnValue(41);
		const migration = migrationHarness(view.containerEl);

		await view.onOpen();
		expect(migration.listeners.size).toBe(1);
		oldWindow.document.dispatchEvent(keyDownEvent(oldWindow));
		expect(keyDown).toHaveBeenCalledOnce();
		keyDown.mockClear();
		const nextWindow = secondWindow();
		vi.spyOn(nextWindow, "requestAnimationFrame").mockReturnValue(42);
		nextWindow.document.body.append(view.containerEl);

		migration.emitQueuedTwice(nextWindow);
		expect(migration.listeners.size).toBe(0);
		expect(state.renderers).toHaveLength(1);
		await vi.waitFor(() => expect(flushSettings).toHaveBeenCalledOnce());
		finishFlush();
		await vi.waitFor(() => expect(state.renderers).toHaveLength(2));
		await Promise.resolve();

		expect(state.renderers).toHaveLength(2);
		expect(state.renderers[0].destroy).toHaveBeenCalledOnce();
		expect(state.renderers[1].ownerWindow).toBe(nextWindow);
		expect(oldCancelFrame).toHaveBeenCalledWith(41);
		expect(migration.listeners.size).toBe(1);
		oldWindow.document.dispatchEvent(keyDownEvent(oldWindow));
		expect(keyDown).not.toHaveBeenCalled();
		nextWindow.document.dispatchEvent(keyDownEvent(nextWindow));
		expect(keyDown).toHaveBeenCalledOnce();
		await view.onClose();
	});

	test("reopens the local graph once in the new window", async () => {
		const app = appHarness();
		const plugin = { settings: structuredClone(DEFAULT_SETTINGS) };
		const view = new LocalGraphView(
			{ app } as unknown as WorkspaceLeaf,
			plugin as ConstructorParameters<typeof LocalGraphView>[1],
		);
		const oldWindow = view.contentEl.ownerDocument.defaultView!;
		const oldCancelFrame = vi.spyOn(oldWindow, "cancelAnimationFrame");
		vi.spyOn(oldWindow, "requestAnimationFrame").mockReturnValue(51);
		const migration = migrationHarness(view.containerEl);

		await view.onOpen();
		expect(migration.listeners.size).toBe(1);
		const nextWindow = secondWindow();
		vi.spyOn(nextWindow, "requestAnimationFrame").mockReturnValue(52);
		nextWindow.document.body.append(view.containerEl);
		migration.emitQueuedTwice(nextWindow);
		await vi.waitFor(() => expect(state.renderers).toHaveLength(2));
		await Promise.resolve();

		expect(state.renderers).toHaveLength(2);
		expect(state.renderers[0].destroy).toHaveBeenCalledOnce();
		expect(state.renderers[1].ownerWindow).toBe(nextWindow);
		expect(oldCancelFrame).toHaveBeenCalledWith(51);
		expect(migration.listeners.size).toBe(1);
		await view.onClose();
	});

	test("a preview read from an old open cannot write into the reopened tooltip", async () => {
		const view = new GraphInsightView(
			{ app: appHarness() } as unknown as WorkspaceLeaf,
			{ settings: DEFAULT_SETTINGS } as ConstructorParameters<typeof GraphInsightView>[1],
		);
		let finishPreview!: (text: string) => void;
		const internal = view as unknown as {
			model: GraphModel;
			openGeneration: number;
			tooltip: HTMLElement;
			tooltipNodeId: number;
			notePreview(): Promise<string>;
			appendNotePreview(nodeId: number, words: number): Promise<void>;
		};
		internal.model = buildGraphModel(["a.md"], {}, {});
		internal.openGeneration = 1;
		internal.tooltipNodeId = 0;
		internal.tooltip = document.body.createDiv();
		internal.notePreview = () => new Promise<string>((resolve) => { finishPreview = resolve; });
		const pending = internal.appendNotePreview(0, 20);
		const reopenedTooltip = document.body.createDiv();
		internal.openGeneration = 2;
		internal.tooltip = reopenedTooltip;

		finishPreview("stale preview");
		await pending;

		expect(reopenedTooltip.querySelector(".graph-insight-tooltip-preview")).toBeNull();
	});

	test("a host close cancels a queued main graph migration reopen", async () => {
		let finishInternalClose!: () => void;
		let flushCalls = 0;
		const { plugin, view } = mainView(() => {
			flushCalls++;
			if (flushCalls > 1) return Promise.resolve();
			return new Promise<void>((resolve) => { finishInternalClose = resolve; });
		});
		const migration = migrationHarness(view.containerEl);
		await view.onOpen();

		migration.emitQueuedTwice(view.contentEl.ownerDocument.defaultView!);
		await vi.waitFor(() => expect(plugin.flushSettings).toHaveBeenCalledOnce());
		const queuedReopen = (view as unknown as { reopenPromise: Promise<void> }).reopenPromise;
		await view.onClose();
		finishInternalClose();
		await queuedReopen;

		expect(state.renderers).toHaveLength(1);
		expect(state.renderers[0].destroy).toHaveBeenCalledOnce();
		expect(migration.listeners.size).toBe(0);
	});

	test("a host close cancels a queued local graph migration reopen", async () => {
		const view = new LocalGraphView(
			{ app: appHarness() } as unknown as WorkspaceLeaf,
			{ settings: structuredClone(DEFAULT_SETTINGS) } as ConstructorParameters<typeof LocalGraphView>[1],
		);
		const migration = migrationHarness(view.containerEl);
		await view.onOpen();

		migration.emitQueuedTwice(view.contentEl.ownerDocument.defaultView!);
		await Promise.resolve();
		const queuedReopen = (view as unknown as { reopenPromise: Promise<void> }).reopenPromise;
		await view.onClose();
		await queuedReopen;

		expect(state.renderers).toHaveLength(1);
		expect(state.renderers[0].destroy).toHaveBeenCalledOnce();
		expect(migration.listeners.size).toBe(0);
	});

	test("a failed migration save still tears down and reports the failure", async () => {
		const failure = new Error("save failed");
		let flushCalls = 0;
		const { view } = mainView(async () => {
			flushCalls++;
			if (flushCalls === 1) throw failure;
		});
		const migration = migrationHarness(view.containerEl);
		const report = vi.spyOn(console, "error").mockImplementation(() => {});
		await view.onOpen();

		migration.emitQueuedTwice(view.contentEl.ownerDocument.defaultView!);
		await vi.waitFor(() => expect(state.renderers[0].destroy).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(report).toHaveBeenCalled());

		expect(state.renderers).toHaveLength(2);
		expect(report).toHaveBeenCalledWith("Advanced Graph View: window migration reload failed", failure);
		await view.onClose();
	});

	test("a settings reload reopens the graph and propagates a failed save", async () => {
		const failure = new Error("save failed");
		let flushCalls = 0;
		const { view } = mainView(async () => {
			flushCalls++;
			if (flushCalls === 1) throw failure;
		});
		await view.onOpen();

		await expect(view.reloadFromSettings()).rejects.toBe(failure);

		expect(state.renderers).toHaveLength(2);
		expect(state.renderers[0].destroy).toHaveBeenCalledOnce();
		await view.onClose();
	});
});
