// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { GraphInsightView } from "./GraphView";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";

const unloadDomListeners = vi.hoisted(() => [] as Array<() => void>);

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		leaf: unknown;
		contentEl = document.body.createDiv();
		containerEl = this.contentEl;
		constructor(leaf: { app: unknown }) { this.app = leaf.app; this.leaf = leaf; }
		registerDomEvent(target: EventTarget, type: string, callback: EventListener, options?: AddEventListenerOptions): void {
			target.addEventListener(type, callback, options);
			unloadDomListeners.push(() => target.removeEventListener(type, callback, options));
		}
		registerEvent(): void {}
	},
	debounce: (callback: () => void) => callback,
}));
vi.mock("../render/GraphRenderer", () => ({
	GraphRenderer: class {
		currentPositions = null;
		setSelected = vi.fn();
		centerOnNode = vi.fn();
		getCameraState(): null { return null; }
		init(): Promise<void> { return Promise.resolve(); }
		resize(): void {}
		destroy(): void {}
	},
}));
vi.mock("../workers/LayoutClient", () => ({ LayoutClient: class { stop(): void {} } }));
vi.mock("../workers/MetricsClient", () => ({ MetricsClient: class { stop(): void {} } }));

interface Subscription {
	name: string;
	callback: (...args: unknown[]) => void;
}

class EventHub {
	readonly listeners = new Set<Subscription>();
	on(name: string, callback: Subscription["callback"]): Subscription {
		const ref = { name, callback };
		this.listeners.add(ref);
		return ref;
	}
	offref(ref: Subscription): void { this.listeners.delete(ref); }
	emit(name: string, ...args: unknown[]): void {
		for (const ref of this.listeners) if (ref.name === name) ref.callback(...args);
	}
}

interface ViewHarness {
	model: GraphModel | null;
	selfOpenedPath: string | null;
	renderer: { setSelected: ReturnType<typeof vi.fn>; centerOnNode: ReturnType<typeof vi.fn> };
	autoFit: { cancel(): void };
	buildPanel(): { setViewPresets(): void; destroy(): void };
	rebuildGraph(): Promise<void>;
	handleKeyDown(event: KeyboardEvent): void;
	handleMetadataResolved(): void;
	handleThemeChange(): void;
}

beforeAll(() => { installObsidianDom(); initI18n("en"); });
afterEach(() => {
	for (const remove of unloadDomListeners.splice(0)) remove();
	vi.restoreAllMocks();
	document.body.empty();
});

function setup() {
	const workspace = Object.assign(new EventHub(), { getActiveViewOfType: () => null });
	const metadataCache = new EventHub();
	const vault = new EventHub();
	const plugin = {
		settings: { ...DEFAULT_SETTINGS, followActiveNote: true },
		showOnboarding: vi.fn(),
		flushSettings: vi.fn(async () => {}),
	};
	const view = new GraphInsightView(
		{ app: { workspace, metadataCache, vault } } as unknown as WorkspaceLeaf,
		plugin as unknown as ConstructorParameters<typeof GraphInsightView>[1]
	);
	const internal = view as unknown as ViewHarness;
	view.contentEl.setCssProps = vi.fn();
	internal.buildPanel = () => ({ setViewPresets: vi.fn(), destroy: vi.fn() });
	internal.rebuildGraph = vi.fn(async () => { internal.model = buildGraphModel(["note.md"], {}, {}); });
	return { view, internal, plugin, workspace, metadataCache, vault };
}

describe("GraphView subscriptions across reloads", () => {
	test("handles file-open once after two reloads and preserves the one-shot self-open exemption", async () => {
		const { view, internal, workspace, metadataCache, vault } = setup();
		await view.onOpen();
		await view.reloadFromSettings();
		await view.reloadFromSettings();
		try {
			internal.selfOpenedPath = "note.md";
			workspace.emit("file-open", { path: "note.md" });
			expect(internal.selfOpenedPath).toBeNull();
			expect(internal.renderer.setSelected).not.toHaveBeenCalled();
			expect(internal.renderer.centerOnNode).not.toHaveBeenCalled();

			workspace.emit("file-open", { path: "note.md" });
			expect(internal.renderer.setSelected).toHaveBeenCalledExactlyOnceWith(0);
			expect(internal.renderer.centerOnNode).toHaveBeenCalledExactlyOnceWith(0);
			expect(workspace.listeners.size).toBe(2);
			expect(metadataCache.listeners.size).toBe(1);
			expect(vault.listeners.size).toBe(1);
		} finally {
			await view.onClose();
		}
	});

	test("handles keyboard, pointer, metadata and theme events once after reload", async () => {
		const { view, internal, metadataCache, workspace } = setup();
		const keyDown = vi.spyOn(internal, "handleKeyDown").mockImplementation(() => {});
		const cancelFit = vi.spyOn(internal.autoFit, "cancel");
		const metadata = vi.spyOn(internal, "handleMetadataResolved").mockImplementation(() => {});
		const theme = vi.spyOn(internal, "handleThemeChange").mockImplementation(() => {});
		await view.onOpen();
		await view.reloadFromSettings();
		try {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			view.contentEl.dispatchEvent(new Event("pointerdown"));
			metadataCache.emit("resolved");
			workspace.emit("css-change");
			expect(keyDown).toHaveBeenCalledOnce();
			expect(cancelFit).toHaveBeenCalledOnce();
			expect(metadata).toHaveBeenCalledOnce();
			expect(theme).toHaveBeenCalledOnce();
		} finally {
			await view.onClose();
		}
	});

	test("detaches all open listeners before awaiting settings persistence", async () => {
		const { view, internal, plugin, workspace, metadataCache, vault } = setup();
		const keyDown = vi.spyOn(internal, "handleKeyDown").mockImplementation(() => {});
		const cancelFit = vi.spyOn(internal.autoFit, "cancel");
		await view.onOpen();
		let finish!: () => void;
		plugin.flushSettings.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
		const closing = view.onClose();
		try {
			expect(workspace.listeners.size).toBe(0);
			expect(metadataCache.listeners.size).toBe(0);
			expect(vault.listeners.size).toBe(0);
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			view.contentEl.dispatchEvent(new Event("wheel"));
			expect(keyDown).not.toHaveBeenCalled();
			expect(cancelFit).not.toHaveBeenCalled();
		} finally {
			finish();
			await closing;
		}
	});
});
