import { installObsidianDom } from "../../src/test/obsidianDom";
import { initI18n } from "../../src/i18n";
import { DEFAULT_SETTINGS, type GraphInsightSettings } from "../../src/settings/schema";
import { DEFAULT_VIEW_PRESETS } from "../../src/view/builtinPresets";
import { GraphInsightView } from "../../src/view/GraphView";
import { TFile } from "./obsidianAdapter";

declare global {
	interface HTMLElement {
		hasClass(name: string): boolean;
		setCssProps(properties: Record<string, string>): void;
	}
	interface Window {
		uiHarness?: { view: GraphInsightView | null; app: unknown; plugin: unknown };
	}
}

installObsidianDom();
// Obsidian exposes the same creation helpers on document fragments used by notices.
Object.assign(DocumentFragment.prototype, {
	createEl: HTMLElement.prototype.createEl,
	createDiv: HTMLElement.prototype.createDiv,
	createSpan: HTMLElement.prototype.createSpan,
});
HTMLElement.prototype.hasClass = function (name: string): boolean { return this.classList.contains(name); };
HTMLElement.prototype.setCssProps = function (properties: Record<string, string>): void {
	for (const [name, value] of Object.entries(properties)) this.style.setProperty(name, value);
};
HTMLElement.prototype.hide = function (): HTMLElement {
	this.hidden = true;
	this.style.display = "none";
	return this;
};
HTMLElement.prototype.show = function (): HTMLElement {
	this.hidden = false;
	this.style.removeProperty("display");
	return this;
};
HTMLElement.prototype.isShown = function (): boolean {
	return !this.hidden && this.style.display !== "none";
};
(window as unknown as { createEl: (tag: string, info?: { attr?: Record<string, string> }) => HTMLElement }).createEl =
	(tag, info) => {
		const element = document.createElement(tag);
		for (const [name, value] of Object.entries(info?.attr ?? {})) element.setAttribute(name, value);
		return element;
	};
initI18n("en");

type VaultMode = "normal" | "empty";
type Theme = "dark" | "light";

interface NoteSpec {
	path: string;
	tags: string[];
	links: string[];
	text?: string;
}

const NOTE_NAMES = [
	["Atlas/Home.md", ["atlas", "hub"]],
	["Atlas/Ideas Index.md", ["atlas", "ideas"]],
	["Atlas/Projects Index.md", ["atlas", "projects"]],
	["Atlas/People Index.md", ["atlas", "people"]],
	["Projects/Graph Explorer.md", ["project", "active"]],
	["Projects/Graph Explorer - Visual QA.md", ["project", "qa"]],
	["Projects/Graph Explorer - Search Design.md", ["project", "design"]],
	["Projects/Graph Explorer - Release Notes.md", ["project", "release"]],
	["Projects/Field Notes App.md", ["project", "active"]],
	["Projects/Field Notes - Sync.md", ["project", "engineering"]],
	["Projects/Reading Workflow.md", ["project", "workflow"]],
	["Projects/Personal Knowledge Garden.md", ["project", "knowledge"]],
	["Research/Network Science.md", ["research", "graph"]],
	["Research/PageRank Notes.md", ["research", "graph"]],
	["Research/Community Detection.md", ["research", "graph"]],
	["Research/Force Directed Layouts.md", ["research", "visualization"]],
	["Research/Spatial Interfaces.md", ["research", "design"]],
	["Research/Information Scent.md", ["research", "ux"]],
	["Research/Progressive Disclosure.md", ["research", "ux"]],
	["Research/Local First Software.md", ["research", "engineering"]],
	["People/Ada Lovelace.md", ["people", "history"]],
	["People/Anne-Laure Le Cunff.md", ["people", "knowledge"]],
	["People/Bret Victor.md", ["people", "design"]],
	["People/Donella Meadows.md", ["people", "systems"]],
	["Notes/Graph Vocabulary.md", ["notes", "graph"]],
	["Notes/Interface Questions.md", ["notes", "design"]],
	["Notes/Release Checklist.md", ["notes", "qa"]],
	["Notes/Performance Budget.md", ["notes", "engineering"]],
	["Notes/Search Query Examples.md", ["notes", "search"]],
	["Notes/Small Screen Constraints.md", ["notes", "mobile"]],
	["Daily/2026-09-28.md", ["daily"]],
	["Daily/2026-10-02.md", ["daily"]],
	["Daily/2026-10-06.md", ["daily"]],
	["Daily/2026-10-12.md", ["daily"]],
	["Daily/2026-10-18.md", ["daily"]],
	["Daily/2026-10-20.md", ["daily"]],
	["Archive/Old Graph Prototype.md", ["archive", "graph"]],
	["Archive/Canvas Experiments.md", ["archive", "design"]],
	["Archive/Abandoned Taxonomy.md", ["archive", "knowledge"]],
	["Inbox/Book Notes to Sort.md", ["inbox"]],
	["Inbox/Unlinked Observation.md", ["inbox", "orphan"]],
	["Inbox/Question About Clusters.md", ["inbox", "graph"]],
] as const;

function syntheticNotes(): NoteSpec[] {
	const paths = NOTE_NAMES.map(([path]) => path);
	return NOTE_NAMES.map(([path, tags], index) => {
		const links = new Set<string>();
		if (index > 0) links.add(paths[Math.floor((index - 1) / 4)]);
		if (index < 30) links.add(paths[(index * 7 + 5) % 30]);
		if (path.startsWith("Projects/")) links.add("Atlas/Projects Index.md");
		if (path.startsWith("Research/")) links.add("Research/Network Science.md");
		if (path.startsWith("People/")) links.add("Atlas/People Index.md");
		if (path.startsWith("Daily/")) links.add("Atlas/Home.md");
		if (path.includes("Graph")) links.add("Projects/Graph Explorer.md");
		links.delete(path);
		return {
			path,
			tags: [...tags],
			links: [...links],
			text: `${path.replace(/\.md$/, "")}\n\nSynthetic QA note about ${tags.join(", ")}.`,
		};
	});
}

class Events {
	private listeners = new Map<string, Set<(...args: any[]) => void>>();
	on(name: string, callback: (...args: any[]) => void): { off(): void } {
		const set = this.listeners.get(name) ?? new Set();
		set.add(callback);
		this.listeners.set(name, set);
		return { off: () => set.delete(callback) };
	}
	emit(name: string, ...args: any[]): void {
		for (const callback of this.listeners.get(name) ?? []) callback(...args);
	}
}

function createHost(mode: VaultMode, host: HTMLElement, report: (message: string) => void) {
	const specs = mode === "normal" ? syntheticNotes() : [];
	const now = Date.now();
	const files = specs.map((note, index) => new TFile(note.path, {
		ctime: now - (index + 3) * 18 * 24 * 60 * 60 * 1000,
		mtime: now - (index % 11) * 4 * 24 * 60 * 60 * 1000,
		size: 700 + index * 173,
	}));
	const fileByPath = new Map(files.map((file) => [file.path, file]));
	const specByPath = new Map(specs.map((note) => [note.path, note]));
	const metadataEvents = new Events();
	const workspaceEvents = new Events();
	const resolvedLinks: Record<string, Record<string, number>> = {};
	for (const note of specs) {
		resolvedLinks[note.path] = Object.fromEntries(note.links.map((target) => [target, 1]));
	}
	const unresolvedLinks: Record<string, Record<string, number>> = mode === "normal"
		? { "Notes/Release Checklist.md": { "Missing deployment guide": 1 }, "Inbox/Book Notes to Sort.md": { "Unknown author": 1 } }
		: {};

	const vault = {
		getMarkdownFiles: () => files,
		getAbstractFileByPath: (path: string) => fileByPath.get(path) ?? null,
		cachedRead: async (file: TFile) => specByPath.get(file.path)?.text ?? "",
		create: async () => null,
		createFolder: async () => undefined,
	};
	const metadataCache = {
		resolvedLinks,
		unresolvedLinks,
		getFileCache: (file: TFile) => ({ tags: (specByPath.get(file.path)?.tags ?? []).map((tag) => ({ tag: `#${tag}` })) }),
		on: (name: string, callback: (...args: any[]) => void) => metadataEvents.on(name, callback),
	};

	let activeView: GraphInsightView | null = null;
	const leaf: any = { id: "ui-harness-leaf", contentEl: host };
	leaf.openFile = async (file: TFile) => { report(`Opened ${file.path} in harness host`); workspaceEvents.emit("file-open", file); };
	const workspace = {
		on: (name: string, callback: (...args: any[]) => void) => workspaceEvents.on(name, callback),
		getActiveViewOfType: () => activeView,
		getLeaf: () => leaf,
		getLeafById: () => leaf,
		getLeavesOfType: () => [],
		iterateAllLeaves: (callback: (candidate: any) => void) => callback(leaf),
		createLeafBySplit: () => leaf,
		revealLeaf: async () => undefined,
	};
	const app: any = {
		vault,
		metadataCache,
		workspace,
		emitCssChange: () => workspaceEvents.emit("css-change"),
	};
	leaf.app = app;

	const settings = structuredClone(DEFAULT_SETTINGS) as GraphInsightSettings;
	settings.panel = { ...settings.panel, showTimeline: true };
	settings.panelMode = "simple";
	settings.onboardingState = "dismissed";
	settings.viewPresets = structuredClone(DEFAULT_VIEW_PRESETS);
	const plugin: any = {
		settings,
		usageLog: {},
		sessionTrail: [],
		snapshotStore: { version: 1, snapshots: [] },
		dataStore: {
			loadPositions: async () => null,
			savePositions: async () => undefined,
		},
		maybeCaptureSnapshot: async () => undefined,
		savePanelState: async (panel: GraphInsightSettings["panel"]) => { plugin.settings = { ...plugin.settings, panel }; },
		savePanelMode: async (panelMode: GraphInsightSettings["panelMode"]) => { plugin.settings = { ...plugin.settings, panelMode }; },
		saveCollapsedSections: async (collapsedSections: GraphInsightSettings["collapsedSections"]) => { plugin.settings = { ...plugin.settings, collapsedSections }; },
		saveChipFilter: async (chipFilter: GraphInsightSettings["chipFilter"]) => { plugin.settings = { ...plugin.settings, chipFilter }; },
		savePresets: async (presets: GraphInsightSettings["presets"]) => { plugin.settings = { ...plugin.settings, presets }; },
		saveViewPresets: async (viewPresets: GraphInsightSettings["viewPresets"]) => { plugin.settings = { ...plugin.settings, viewPresets }; },
		setFollowActiveNote: async (followActiveNote: boolean) => { plugin.settings = { ...plugin.settings, followActiveNote }; },
		setOpenInSidePane: async (openInSidePane: boolean) => { plugin.settings = { ...plugin.settings, openInSidePane }; },
		activateLocalGraph: async () => report("Local graph is outside this harness"),
		showOnboarding: () => undefined,
	};
	const view = new GraphInsightView(leaf, plugin);
	leaf.view = view;
	activeView = view;
	return { app, plugin, view };
}

const host = document.getElementById("view-host") as HTMLElement;
const stage = document.getElementById("stage") as HTMLElement;
const status = document.getElementById("harness-status") as HTMLOutputElement;
const errors = document.getElementById("harness-errors") as HTMLElement;
let current: ReturnType<typeof createHost> | null = null;
let vaultMode: VaultMode = "normal";

function report(message: string): void { status.value = message; status.textContent = message; }
function showError(error: unknown): void {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	errors.textContent = message;
	report("Harness error");
}

async function mount(mode: VaultMode): Promise<void> {
	report("Building view...");
	errors.empty();
	if (current) {
		await current.view.onClose();
		(current.view as unknown as { unload(): void }).unload();
	}
	host.empty();
	current = createHost(mode, host, report);
	window.uiHarness = current;
	await current.view.onOpen();
	current.view.onResize();
	report(mode === "normal" ? "42 synthetic notes" : "Empty synthetic vault");
}

function selectButtons(attribute: string, value: string): void {
	document.querySelectorAll<HTMLButtonElement>(`button[${attribute}]`).forEach((button) => {
		button.classList.toggle("is-active", button.getAttribute(attribute) === value);
	});
}

document.querySelectorAll<HTMLButtonElement>("button[data-width]").forEach((button) => {
	button.addEventListener("click", () => {
		const width = button.dataset.width ?? "1200";
		stage.dataset.width = width;
		selectButtons("data-width", width);
		requestAnimationFrame(() => current?.view.onResize());
		report(`${width} px container`);
	});
});

document.querySelectorAll<HTMLButtonElement>("button[data-theme]").forEach((button) => {
	button.addEventListener("click", () => {
		const theme = (button.dataset.theme ?? "dark") as Theme;
		document.body.classList.toggle("theme-light", theme === "light");
		document.body.classList.toggle("theme-dark", theme === "dark");
		selectButtons("data-theme", theme);
		(current?.app as any)?.emitCssChange();
		window.dispatchEvent(new Event("resize"));
		report(`${theme} theme`);
	});
});

document.querySelectorAll<HTMLButtonElement>("button[data-vault]").forEach((button) => {
	button.addEventListener("click", () => {
		vaultMode = (button.dataset.vault ?? "normal") as VaultMode;
		selectButtons("data-vault", vaultMode);
		void mount(vaultMode).catch(showError);
	});
});

window.addEventListener("error", (event) => showError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => showError(event.reason));
void mount(vaultMode).catch(showError);
