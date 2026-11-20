// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { LocalGraphView } from "./LocalGraphView";

interface Ref {
	callback: (...args: unknown[]) => void;
}

const state = vi.hoisted(() => ({
	initCalls: [] as Array<{ host: HTMLElement; renderScale: unknown }>,
	renderers: [] as Array<{
		destroy: ReturnType<typeof vi.fn>;
		resize: ReturnType<typeof vi.fn>;
		setModel: ReturnType<typeof vi.fn>;
		setModernAppearance: ReturnType<typeof vi.fn>;
	}>,
	debouncers: [] as Array<{ cancel: ReturnType<typeof vi.fn> }>,
}));

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		leaf: unknown;
		contentEl = document.body.createDiv();
		constructor(leaf: { app: unknown }) { this.app = leaf.app; this.leaf = leaf; }
		registerDomEvent(
			el: HTMLElement,
			type: keyof HTMLElementEventMap,
			callback: EventListener
		): void {
			el.addEventListener(type, callback);
		}
		registerEvent(): void {}
	},
	debounce: (callback: () => void) => {
		const debounced = () => {
			callback();
			return debounced;
		};
		debounced.cancel = vi.fn(() => debounced);
		debounced.run = () => callback();
		state.debouncers.push(debounced);
		return debounced;
	},
}));

vi.mock("../render/GraphRenderer", () => ({
	GraphRenderer: class {
		pause = vi.fn();
		resume = vi.fn();
		destroy = vi.fn();
		resize = vi.fn();
		setModel = vi.fn();
		set3DMode = vi.fn();
		setCameraFocal = vi.fn();
		setLabelOptions = vi.fn();
		setEdgeStyle = vi.fn();
		setVisualStyle = vi.fn();
		applyEncoding = vi.fn();
		setHighlightMask = vi.fn();
		setAlphaFactors = vi.fn();
		setModernAppearance = vi.fn();
		constructor() { state.renderers.push(this); }
		init(host: HTMLElement, renderScale?: unknown): Promise<void> {
			state.initCalls.push({ host, renderScale });
			return Promise.resolve();
		}
	},
}));

vi.mock("../workers/LayoutClient", () => ({
	LayoutClient: class {
		start(): void {}
		setParams(): void {}
		stop(): void {}
	},
}));

function eventSource() {
	const refs = new Set<Ref>();
	return {
		on: vi.fn((_name: string, callback: (...args: unknown[]) => void) => {
			const ref = { callback };
			refs.add(ref);
			return ref;
		}),
		offref: vi.fn((ref: Ref) => refs.delete(ref)),
		listenerCount: () => refs.size,
	};
}

function setup(activeFiles: Array<{ path: string; extension: string } | null> = []) {
	const workspaceEvents = eventSource();
	const metadataEvents = eventSource();
	let activeIndex = 0;
	const app = {
		workspace: {
			...workspaceEvents,
			getActiveFile: () => activeFiles[activeIndex++] ?? null,
		},
		metadataCache: { ...metadataEvents, resolvedLinks: {}, unresolvedLinks: {} },
		vault: { getMarkdownFiles: () => [{ path: "kept.md" }] },
	};
	const plugin = {
		settings: { ...structuredClone(DEFAULT_SETTINGS), renderScale: "high" as const },
	};
	const view = new LocalGraphView(
		{ app } as unknown as WorkspaceLeaf,
		plugin as ConstructorParameters<typeof LocalGraphView>[1]
	);
	const cancelAutoFit = vi.fn();
	Object.assign(view as unknown as { autoFit: { cancel(): void } }, {
		autoFit: {
			cancel: cancelAutoFit,
			request: vi.fn(),
			isPending: () => false,
			consume: () => false,
		},
	});
	return { cancelAutoFit, metadataEvents, view, workspaceEvents };
}

beforeAll(() => {
	installObsidianDom();
	HTMLElement.prototype.toggle = function (shown: boolean): void {
		this.hidden = !shown;
	};
	initI18n("en");
});

beforeEach(() => {
	state.initCalls.length = 0;
	state.renderers.length = 0;
	state.debouncers.length = 0;
	vi.stubGlobal("IntersectionObserver", class {
		observe(): void {}
		disconnect(): void {}
	});
});

afterEach(() => {
	document.body.empty();
	vi.unstubAllGlobals();
});

describe("local graph settings reload", () => {
	test.each([
		[{}, false],
		[{ version: 1, appearance: { version: 1, mode: "legacy", panel: { nodeScale: 2 } } }, false],
		[{ version: 1, appearance: { version: 1, mode: "modern", panel: { nodeScale: 2 } } }, true],
	] as const)("round-trips old and new leaf state %#", async (saved, modern) => {
		const { view } = setup();
		await view.setState(saved, { history: false });
		await view.onOpen();

		expect(state.renderers[0].setModernAppearance).toHaveBeenCalledWith(modern, 0.18);
		expect(view.getState()).toMatchObject({
			version: 1,
			appearance: { version: 1, mode: modern ? "modern" : "legacy" },
		});
		await view.onClose();
	});

	test("passes the saved render scale into renderer startup", async () => {
		const { view } = setup();
		await view.onOpen();

		expect(state.initCalls).toEqual([{ host: view.contentEl, renderScale: "high" }]);
		await view.onClose();
	});

	test("reopens without accumulating event handlers", async () => {
		const { cancelAutoFit, metadataEvents, view, workspaceEvents } = setup();
		await view.onOpen();
		const reloadable = view as LocalGraphView & { reloadFromSettings?: () => Promise<void> };
		const hasReload = typeof reloadable.reloadFromSettings === "function";
		expect(hasReload).toBe(true);
		if (!hasReload) return;

		await reloadable.reloadFromSettings();

		expect(workspaceEvents.listenerCount()).toBe(1);
		expect(metadataEvents.listenerCount()).toBe(1);
		expect(state.debouncers[0].cancel).toHaveBeenCalledOnce();
		expect(state.renderers[0].destroy).toHaveBeenCalledOnce();
		view.contentEl.dispatchEvent(new Event("pointerdown"));
		expect(cancelAutoFit).toHaveBeenCalledOnce();

		await view.onClose();
		expect(workspaceEvents.listenerCount()).toBe(0);
		expect(metadataEvents.listenerCount()).toBe(0);
	});

	test("rebuilds the previous neighborhood when no file is active after reopen", async () => {
		const note = { path: "kept.md", extension: "md" };
		const { view } = setup([note, null]);
		await view.onOpen();
		expect(state.renderers[0].setModel).toHaveBeenCalledOnce();

		await view.reloadFromSettings();

		expect(state.renderers[1].setModel).toHaveBeenCalledOnce();
		await view.onClose();
	});
});
