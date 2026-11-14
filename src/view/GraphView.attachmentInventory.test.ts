// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from "vitest";
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

test("attachment events during the initial async model build schedule a refresh", async () => {
	const { view, internal, plugin, vault } = setup();
	plugin.settings.graphScope = { attachments: true, unresolved: false };
	let finish!: () => void;
	let started!: () => void;
	const rebuilding = new Promise<void>(resolve => { started = resolve; });
	internal.rebuildGraph = vi.fn(() => {
		started();
		return new Promise<void>(resolve => { finish = resolve; });
	});
	const refresh = vi.fn();
	Object.assign(internal, { rebuildDebounced: refresh });
	const opening = view.onOpen();
	await rebuilding;
	try {
		vault.emit("create", { path: "new.png" });
		expect(refresh).toHaveBeenCalledOnce();
	} finally {
		finish();
		await opening;
		await view.onClose();
	}
	vault.emit("create", { path: "after-close.png" });
	expect(refresh).toHaveBeenCalledOnce();
	expect(vault.listeners.size).toBe(0);
});
