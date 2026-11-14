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

const LINKED_ATTACHMENT_PATH = "Attachments/Graph Explorer.png";
const UNLINKED_ATTACHMENT_PATH = "Attachments/Loose Reference.pdf";

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
		if (path === "Projects/Graph Explorer.md") links.add(LINKED_ATTACHMENT_PATH);
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
	const noteFiles = specs.map((note, index) => new TFile(note.path, {
		ctime: now - (index + 3) * 18 * 24 * 60 * 60 * 1000,
		mtime: now - (index % 11) * 4 * 24 * 60 * 60 * 1000,
		size: 700 + index * 173,
	}));
	const attachmentFiles = mode === "normal" ? [
		new TFile(LINKED_ATTACHMENT_PATH, { ctime: now - 50_000, mtime: now - 20_000, size: 24_000 }),
		new TFile(UNLINKED_ATTACHMENT_PATH, { ctime: now - 40_000, mtime: now - 10_000, size: 18_000 }),
	] : [];
	const files = [...noteFiles, ...attachmentFiles];
	const fileByPath = new Map(files.map((file) => [file.path, file]));
	const specByPath = new Map(specs.map((note) => [note.path, note]));
	const vaultEvents = new Events();
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
		on: (name: string, callback: (...args: any[]) => void) => vaultEvents.on(name, callback),
		offref: (ref: { off(): void }) => ref.off(),
		getFiles: () => files,
		getMarkdownFiles: () => noteFiles,
		getAbstractFileByPath: (path: string) => fileByPath.get(path) ?? null,
		cachedRead: async (file: TFile) => specByPath.get(file.path)?.text ?? "",
		create: async () => null,
		createFolder: async () => undefined,
	};
	const metadataCache = {
		resolvedLinks,
		unresolvedLinks,
		getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
			const normalized = linkpath.replace(/\\/g, "/").replace(/^\/+/, "");
			const sourceFolder = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
			const candidates = [
				normalized,
				`${normalized}.md`,
				sourceFolder ? `${sourceFolder}/${normalized}` : normalized,
				sourceFolder ? `${sourceFolder}/${normalized}.md` : `${normalized}.md`,
			];
			for (const candidate of candidates) {
				const file = fileByPath.get(candidate);
				if (file) return file;
			}
			return files.find((file) => file.basename === normalized || file.basename === normalized.replace(/\.md$/i, "")) ?? null;
		},
		getFileCache: (file: TFile) => ({
			tags: (specByPath.get(file.path)?.tags ?? []).map((tag) => ({ tag: `#${tag}` })),
			frontmatter: { status: file.path.startsWith("Projects/") ? "active" : "reference" },
		}),
		on: (name: string, callback: (...args: any[]) => void) => metadataEvents.on(name, callback),
		offref: (ref: { off(): void }) => ref.off(),
	};

	let activeView: GraphInsightView | null = null;
	const leaf: any = { id: "ui-harness-leaf", contentEl: host };
	leaf.openFile = async (file: TFile) => { report(`Opened ${file.path} in harness host`); workspaceEvents.emit("file-open", file); };
	const workspace = {
		trigger: (name: string, payload: { linktext?: string }) => report(`${name}: ${payload.linktext ?? ""}`),
		on: (name: string, callback: (...args: any[]) => void) => workspaceEvents.on(name, callback),
		offref: (ref: { off(): void }) => ref.off(),
		requestSaveLayout: () => {
			const output = document.getElementById("workspace-state");
			if (output && activeView) output.textContent = JSON.stringify(activeView.getState());
		},
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
	settings.graphScope = { attachments: false, unresolved: false };
	const plugin: any = {
		settings,
		usageLog: {},
		sessionTrail: [],
		snapshotStore: { version: 1, snapshots: [] },
		snapshotsLoaded: true,
		ensureSnapshots: async () => undefined,
		flushSettings: async () => undefined,
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

async function mount(mode: VaultMode, restoredState?: Record<string, unknown>, restoredSettings?: GraphInsightSettings): Promise<void> {
	report("Building view...");
	errors.empty();
	if (current) {
		await current.view.onClose();
		(current.view as unknown as { unload(): void }).unload();
	}
	host.empty();
	current = createHost(mode, host, report);
	window.uiHarness = current;
	if (restoredSettings) current.plugin.settings = restoredSettings;
	if (restoredState) await current.view.setState(restoredState, { history: false });
	await current.view.onOpen();
	current.view.onResize();
	syncGraphScopeControls();
	reportGraphScope();
}

function graphScopeControls(): HTMLInputElement[] {
	return ["scope-attachments", "scope-unresolved"]
		.map((id) => document.getElementById(id))
		.filter((element): element is HTMLInputElement => element instanceof HTMLInputElement);
}

function syncGraphScopeControls(): void {
	const scope = current?.plugin.settings.graphScope ?? { attachments: false, unresolved: false };
	const attachments = document.getElementById("scope-attachments") as HTMLInputElement | null;
	const unresolved = document.getElementById("scope-unresolved") as HTMLInputElement | null;
	if (attachments) attachments.checked = scope.attachments;
	if (unresolved) unresolved.checked = scope.unresolved;
}

function expectedNodeCount(): number {
	if (vaultMode === "empty") return 0;
	const scope = current?.plugin.settings.graphScope ?? { attachments: false, unresolved: false };
	return 43 + (scope.attachments ? 1 : 0) + (scope.unresolved ? 2 : 0);
}

function reportGraphScope(): void {
	const scope = current?.plugin.settings.graphScope ?? { attachments: false, unresolved: false };
	report(
		`Graph scope: attachments=${scope.attachments}, unresolved=${scope.unresolved}. `
		+ `Fixture expected: ${expectedNodeCount()} nodes`
	);
}

async function updateGraphScope(key: "attachments" | "unresolved", checked: boolean): Promise<void> {
	if (!current) return;
	const controls = graphScopeControls();
	for (const control of controls) control.disabled = true;
	try {
		current.plugin.settings = {
			...current.plugin.settings,
			graphScope: { ...current.plugin.settings.graphScope, [key]: checked },
		};
		await current.view.reloadFromSettings();
		reportGraphScope();
	} finally {
		for (const control of controls) control.disabled = false;
	}
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

document.getElementById("scope-attachments")?.addEventListener("change", (event) => {
	const checkbox = event.currentTarget as HTMLInputElement;
	void updateGraphScope("attachments", checkbox.checked).catch(showError);
});

document.getElementById("scope-unresolved")?.addEventListener("change", (event) => {
	const checkbox = event.currentTarget as HTMLInputElement;
	void updateGraphScope("unresolved", checkbox.checked).catch(showError);
});

document.getElementById("workspace-reopen")?.addEventListener("click", () => {
	if (!current) return;
	const state = current.view.getState();
	const settings = structuredClone(current.plugin.settings) as GraphInsightSettings;
	const before = JSON.stringify(state);
	void mount(vaultMode, state, settings).then(() => {
		const after = JSON.stringify(current?.view.getState());
		const output = document.getElementById("workspace-state");
		if (output) output.textContent = `Before: ${before}\nAfter: ${after}`;
		report("Workspace state restored in fresh view");
	}).catch(showError);
});

window.addEventListener("error", (event) => showError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => showError(event.reason));
void mount(vaultMode).catch(showError);
