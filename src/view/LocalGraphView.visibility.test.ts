// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { LocalGraphView } from "./LocalGraphView";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";

const state = vi.hoisted(() => ({
	init: () => Promise.resolve(),
	renderers: [] as Array<{
		pause: ReturnType<typeof vi.fn>;
		resume: ReturnType<typeof vi.fn>;
		resize: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		leaf: unknown;
		contentEl = document.body.createDiv();
		constructor(leaf: { app: unknown }) { this.app = leaf.app; this.leaf = leaf; }
		registerDomEvent(): void {}
		registerEvent(): void {}
	},
	debounce: (callback: () => void) => callback,
}));

vi.mock("../render/GraphRenderer", () => ({
	GraphRenderer: class {
		pause = vi.fn();
		resume = vi.fn();
		resize = vi.fn();
		destroy = vi.fn();
		constructor() { state.renderers.push(this); }
		init(): Promise<void> { return state.init(); }
	},
}));

vi.mock("../workers/LayoutClient", () => ({ LayoutClient: class { stop(): void {} } }));

beforeAll(() => { installObsidianDom(); initI18n("en"); });
beforeEach(() => {
	state.init = () => Promise.resolve();
	state.renderers.length = 0;
});
afterEach(() => { document.body.empty(); vi.unstubAllGlobals(); });

function setup() {
	const observers: Array<{
		callback: IntersectionObserverCallback;
		observe: ReturnType<typeof vi.fn>;
		disconnect: ReturnType<typeof vi.fn>;
	}> = [];
	vi.stubGlobal("IntersectionObserver", class {
		observe = vi.fn();
		disconnect = vi.fn();
		constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
	});
	const app = {
		workspace: { on: vi.fn(() => ({})), getActiveFile: () => null },
		metadataCache: { on: vi.fn(() => ({})) },
	};
	const plugin = { settings: { localGraph: { depth: 2, view3d: true }, panel: {} } };
	const view = new LocalGraphView(
		{ app } as unknown as WorkspaceLeaf,
		plugin as ConstructorParameters<typeof LocalGraphView>[1]
	);
	const notify = (index: number, visible: boolean) => observers[index].callback(
		[{ target: view.contentEl, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as unknown as IntersectionObserverEntry],
		observers[index] as unknown as IntersectionObserver
	);
	return { view, observers, notify };
}

describe("local graph visibility lifecycle", () => {
	test("observes the content pane and stops observation on close", async () => {
		const { view, observers, notify } = setup();
		await view.onOpen();
		expect(observers).toHaveLength(1);
		expect(observers[0].observe).toHaveBeenCalledWith(view.contentEl);
		notify(0, false);
		expect(state.renderers[0].pause).toHaveBeenCalledOnce();
		notify(0, true);
		expect(state.renderers[0].resume).toHaveBeenCalledOnce();

		await view.onClose();
		expect(observers[0].disconnect).toHaveBeenCalledOnce();
		expect(observers[0].disconnect.mock.invocationCallOrder[0]).toBeLessThan(state.renderers[0].destroy.mock.invocationCallOrder[0]);
		notify(0, true);
		expect(state.renderers[0].resume).toHaveBeenCalledOnce();
	});

	test("does not attach an observer when closed during renderer startup", async () => {
		let finish!: () => void;
		state.init = () => new Promise<void>((resolve) => { finish = resolve; });
		const { view, observers } = setup();
		const opening = view.onOpen();
		await view.onClose();
		finish();
		await opening;
		expect(observers).toHaveLength(0);
	});

	test("an old queued observation cannot restart either renderer after reopen", async () => {
		const { view, notify } = setup();
		await view.onOpen();
		await view.onClose();
		await view.onOpen();

		notify(0, true);
		expect(state.renderers[0].resume).not.toHaveBeenCalled();
		expect(state.renderers[1].resume).not.toHaveBeenCalled();
		notify(1, true);
		expect(state.renderers[1].resume).toHaveBeenCalledOnce();
		await view.onClose();
	});
});
