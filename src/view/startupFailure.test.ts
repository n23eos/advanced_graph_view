// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { GraphInsightView } from "./GraphView";
import { LocalGraphView } from "./LocalGraphView";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { DEFAULT_SETTINGS } from "../settings/schema";

const startup = vi.hoisted(() => ({
	init: () => Promise.resolve(),
	renderers: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
	layouts: 0,
	metrics: 0,
}));

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		leaf: unknown;
		contentEl = document.body.createDiv();
		constructor(leaf: { app: unknown }) {
			this.app = leaf.app;
			this.leaf = leaf;
		}
		registerDomEvent(): void {}
		registerEvent(): void {}
	},
	debounce: (callback: () => void) => callback,
}));

vi.mock("../render/GraphRenderer", () => ({
	GraphRenderer: class {
		destroy = vi.fn();
		currentPositions = null;
		constructor() {
			startup.renderers.push(this);
		}
		init(): Promise<void> {
			return startup.init();
		}
		resize(): void {}
	},
}));

vi.mock("../workers/LayoutClient", () => ({
	LayoutClient: class {
		constructor() { startup.layouts++; }
		stop(): void {}
	},
}));

vi.mock("../workers/MetricsClient", () => ({
	MetricsClient: class {
		constructor() { startup.metrics++; }
		stop(): void {}
	},
}));

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

beforeEach(() => {
	document.body.empty();
	startup.init = () => Promise.resolve();
	startup.renderers.length = 0;
	startup.layouts = 0;
	startup.metrics = 0;
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

function leaf(app: unknown = {}): WorkspaceLeaf {
	return { app } as unknown as WorkspaceLeaf;
}

describe("graph startup failure", () => {
	test("the main view shows a retry card and does not start workers", async () => {
		startup.init = () => Promise.reject(new Error("WebGL unavailable"));
		const view = new GraphInsightView(leaf(), {} as ConstructorParameters<typeof GraphInsightView>[1]);

		await expect(view.onOpen()).resolves.toBeUndefined();

		expect(document.querySelector(".graph-insight-startup-error")).not.toBeNull();
		expect(document.body.textContent).toContain("WebGL");
		expect(startup.renderers[0].destroy).toHaveBeenCalledOnce();
		expect(startup.layouts).toBe(0);
		expect(startup.metrics).toBe(0);
	});

	test("retry starts a fresh renderer and a close discards its late init", async () => {
		startup.init = () => Promise.reject(new Error("WebGL unavailable"));
		const view = new GraphInsightView(leaf(), {} as ConstructorParameters<typeof GraphInsightView>[1]);
		await view.onOpen();
		let finish!: () => void;
		startup.init = () => new Promise<void>((resolve) => { finish = resolve; });

		document.querySelector<HTMLButtonElement>(".graph-insight-startup-retry")!.click();
		await vi.waitFor(() => expect(startup.renderers).toHaveLength(2));
		await view.onClose();
		finish();
		await vi.waitFor(() => expect(startup.renderers[1].destroy).toHaveBeenCalledTimes(2));

		expect(startup.layouts).toBe(0);
		expect(startup.metrics).toBe(0);
	});

	test("an old main init rejection cannot clear a successfully reopened tooltip", async () => {
		let rejectOld!: (error: Error) => void;
		startup.init = () => new Promise<void>((_resolve, reject) => { rejectOld = reject; });
		const app = {
			metadataCache: { on: vi.fn(() => ({})) },
			workspace: { on: vi.fn(() => ({})) },
		};
		const plugin = {
			settings: DEFAULT_SETTINGS,
			showOnboarding: vi.fn(),
		};
		const view = new GraphInsightView(
			leaf(app),
			plugin as unknown as ConstructorParameters<typeof GraphInsightView>[1]
		);
		(view.contentEl as HTMLElement & { setCssProps: (props: Record<string, string>) => void })
			.setCssProps = vi.fn();
		const internal = view as unknown as {
			buildPanel: () => { setViewPresets: () => void; destroy: () => void };
			rebuildGraph: () => Promise<void>;
			tooltip: HTMLElement | null;
		};
		internal.buildPanel = () => ({ setViewPresets: vi.fn(), destroy: vi.fn() });
		internal.rebuildGraph = vi.fn().mockResolvedValue(undefined);
		const oldOpening = view.onOpen();

		await view.onClose();
		startup.init = () => Promise.resolve();
		await view.onOpen();

		const currentTooltip = internal.tooltip;
		rejectOld(new Error("stale WebGL failure"));
		await oldOpening;

		expect(currentTooltip).not.toBeNull();
		expect(internal.tooltip).toBe(currentTooltip);
		expect(startup.renderers[1].destroy).not.toHaveBeenCalled();
	});

	test("the local view handles startup failure without creating layout", async () => {
		startup.init = () => Promise.reject(new Error("WebGL unavailable"));
		const plugin = {
			settings: {
				localGraph: { depth: 2, view3d: true },
				panel: {},
			},
		};
		const view = new LocalGraphView(leaf(), plugin as ConstructorParameters<typeof LocalGraphView>[1]);

		await expect(view.onOpen()).resolves.toBeUndefined();

		expect(document.querySelector(".graph-insight-startup-error")).not.toBeNull();
		expect(startup.renderers[0].destroy).toHaveBeenCalledOnce();
		expect(startup.layouts).toBe(0);
	});

	test("closing the local view during init cleans up after init finishes", async () => {
		let finish!: () => void;
		startup.init = () => new Promise<void>((resolve) => { finish = resolve; });
		const plugin = {
			settings: {
				localGraph: { depth: 2, view3d: true },
				panel: {},
			},
		};
		const view = new LocalGraphView(leaf(), plugin as ConstructorParameters<typeof LocalGraphView>[1]);
		const opening = view.onOpen();

		await view.onClose();
		finish();
		await opening;

		expect(startup.renderers[0].destroy).toHaveBeenCalledTimes(2);
		expect(startup.layouts).toBe(0);
	});

	test("an old local init rejection cannot clear a successfully reopened view", async () => {
		let rejectOld!: (error: Error) => void;
		startup.init = () => new Promise<void>((_resolve, reject) => { rejectOld = reject; });
		const app = {
			workspace: {
				on: vi.fn(() => ({})),
				getActiveFile: vi.fn(() => null),
			},
			metadataCache: { on: vi.fn(() => ({})) },
		};
		const plugin = {
			settings: {
				localGraph: { depth: 2, view3d: true },
				panel: {},
			},
		};
		const view = new LocalGraphView(
			leaf(app),
			plugin as ConstructorParameters<typeof LocalGraphView>[1]
		);
		const oldOpening = view.onOpen();

		await view.onClose();
		startup.init = () => Promise.resolve();
		await view.onOpen();

		const reopened = view as unknown as {
			emptyState: HTMLElement | null;
			tooltip: HTMLElement | null;
		};
		const currentEmptyState = reopened.emptyState;
		const currentTooltip = reopened.tooltip;
		rejectOld(new Error("stale WebGL failure"));
		await oldOpening;

		expect(currentEmptyState).not.toBeNull();
		expect(currentTooltip).not.toBeNull();
		expect(reopened.emptyState).toBe(currentEmptyState);
		expect(reopened.tooltip).toBe(currentTooltip);
		expect(startup.renderers[1].destroy).not.toHaveBeenCalled();
	});
});
