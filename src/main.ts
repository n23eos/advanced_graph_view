import { Plugin, TFile, debounce, getLanguage } from "obsidian";
import { GraphInsightView, GRAPH_INSIGHT_VIEW_TYPE } from "./view/GraphView";
import { PluginDataStore } from "./data/persistence";
import {
	compactLog,
	emptyLog,
	pushSessionEntry,
	recordOpen,
	removePath,
	renamePath,
	type SessionEntry,
	type UsageLog,
} from "./data/UsageTracker";
import type { PanelState } from "./ui/ControlPanel";
import type { SearchPreset } from "./ui/SearchBar";
import { InsightsView, INSIGHTS_VIEW_TYPE } from "./view/InsightsView";
import { GraphInsightSettingsTab } from "./settings/SettingsTab";
import { initI18n, t } from "./i18n";
import { migrateViewPresets, type BuiltinPresetId } from "./view/presetNames";

export interface ViewPreset {
	/** Literal name. For bundled presets this is the English original, kept so
	 *  older installs keep matching on it; the UI shows the translated name. */
	name: string;
	/** Set only on bundled presets: the locale key their display name comes
	 *  from. User presets have none and always show their literal name. */
	builtinId?: BuiltinPresetId;
	/** Full panel state snapshot: channels, colors, physics, 3D, layers. */
	panel: PanelState;
}

interface GraphInsightSettings {
	panel: PanelState;
	viewPresets: ViewPreset[];
	presets: SearchPreset[];
	onboardingShown: boolean;
	/** Version of the built-in view presets last seeded. Lower than
	 *  VIEW_PRESET_VERSION triggers a one-time re-seed + retire migration. */
	viewPresetsVersion: number;
	/** Open counts only when the file stays active at least this long. */
	openDwellSeconds: number;
	/** Note-body preview shown in the hover tooltip. */
	hoverPreview: HoverPreviewSettings;
	/** Last tag/folder filter, restored on the next session. */
	chipFilter: { tags: string[]; folders: string[] };
	/** Camera follows the note you open elsewhere in the vault. Not part of
	 *  PanelState: it is how the view behaves, not what a view preset looks like. */
	followActiveNote: boolean;
}

interface HoverPreviewSettings {
	/** When off, the tooltip stays name + metadata only. */
	enabled: boolean;
	/** How many leading words of the note body to show. */
	words: number;
	/** Hold the cursor on a node this long before the preview loads. */
	delayMs: number;
}

/** Fixed fields shared by every bundled panel snapshot, so each preset only
 *  spells out what actually differs. */
type PanelSpec = Pick<
	PanelState,
	"channels" | "colorPreset" | "physics" | "labels" | "edges" | "nodeScale" | "view3d"
> & { showBubbles?: boolean };

function makePanel(spec: PanelSpec): PanelState {
	return {
		channels: spec.channels,
		colorPreset: spec.colorPreset,
		collapsed: false,
		overlays: { orphans: false, deadEnds: false, broken: false },
		showBubbles: spec.showBubbles ?? false,
		showTimeline: false,
		showTrail: false,
		physics: spec.physics,
		labels: spec.labels,
		edges: spec.edges,
		nodeScale: spec.nodeScale,
		view3d: spec.view3d,
	};
}

/** The out-of-the-box view: a 3D galaxy. Also seeded as the "Default 3D" preset. */
const DEFAULT_3D_PANEL = makePanel({
	channels: { size: "links-out", color: "cluster", glow: null },
	colorPreset: "galaxy",
	physics: {
		repel: 112, linkDistance: 205, centering: 0.245,
		linkStrength: 0.08, velocityDecay: 0.45, elasticity: 0.35, freeLayout: true, disabled: false,
	},
	labels: { show: true, fontSize: 11, zoomThreshold: 1.53, maxCount: 140, scaleWithZoom: true },
	edges: { show: true, width: 0.4, opacity: 0.21 },
	nodeScale: 1.2,
	view3d: { enabled: true, depthSource: "physics", focal: 900 },
});

const DEFAULT_SETTINGS: GraphInsightSettings = {
	panel: DEFAULT_3D_PANEL,
	openDwellSeconds: 5,
	hoverPreview: { enabled: true, words: 300, delayMs: 350 },
	chipFilter: { tags: [], folders: [] },
	followActiveNote: false,
	presets: [],
	viewPresets: [],
	viewPresetsVersion: 0,
	onboardingShown: false,
};

/** Bump when DEFAULT_VIEW_PRESETS changes so existing installs re-seed. */
const VIEW_PRESET_VERSION = 6;
/** Default preset names retired in newer versions — removed on migration. */
const RETIRED_VIEW_PRESETS = new Set([
	"3D галактика", "Хабы и кластеры", "Недавнее", "Мелкие ноды",
	"Широкий разброс", "Плотный клубок", "Минимализм",
]);

/** Bundled presets, copied from the tuned Raincoat vault. "Default 3D" first —
 *  it matches the out-of-the-box panel. */
const DEFAULT_VIEW_PRESETS: ViewPreset[] = [
	{ builtinId: "default-3d", name: "Default 3D", panel: DEFAULT_3D_PANEL },
	{
		builtinId: "default-2d",
		name: "Default 2D",
		panel: makePanel({
			channels: { size: "links-in", color: "cluster", glow: null },
			colorPreset: "galaxy",
			physics: {
				repel: 157, linkDistance: 90, centering: 0.355,
				linkStrength: 0.08, velocityDecay: 0.55, elasticity: 0.4, freeLayout: true,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 2.05,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "hubs-clusters",
		name: "Hubs and Clusters",
		panel: makePanel({
			channels: { size: "pagerank", color: "cluster", glow: "links-total" },
			colorPreset: "galaxy",
			showBubbles: true,
			physics: {
				repel: 30, linkDistance: 25, centering: 0.09,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 0.8,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "recent",
		name: "Recent",
		panel: makePanel({
			channels: { size: "opens-30", color: "recency-edit", glow: null },
			colorPreset: "heat",
			physics: {
				repel: 30, linkDistance: 25, centering: 0.09,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 1.25,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "wide-range",
		name: "Wide Range",
		panel: makePanel({
			channels: { size: "pagerank", color: "recency-edit", glow: null },
			colorPreset: "recency",
			physics: {
				repel: 158, linkDistance: 120, centering: 0.355,
				linkStrength: 0.08, velocityDecay: 0.55, elasticity: 0.4, freeLayout: true,
			},
			labels: { show: true, fontSize: 11, zoomThreshold: 0.73, maxCount: 40, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 2.5,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "density",
		name: "Density",
		panel: makePanel({
			channels: { size: "pagerank", color: "recency-edit", glow: null },
			colorPreset: "recency",
			physics: {
				repel: 5, linkDistance: 125, centering: 0.265,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.55, freeLayout: true,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.15, opacity: 0.18 },
			nodeScale: 0.95,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "small-nodes-2d",
		name: "Small Nodes 2D",
		panel: makePanel({
			channels: { size: "pagerank", color: "recency-edit", glow: null },
			colorPreset: "recency",
			physics: {
				repel: 30, linkDistance: 25, centering: 0.09,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
			},
			labels: { show: true, fontSize: 10, zoomThreshold: 1.78, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.15 },
			nodeScale: 0.55,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "minimalism",
		name: "Minimalism",
		panel: makePanel({
			channels: { size: "pagerank", color: "recency-edit", glow: null },
			colorPreset: "mono",
			physics: {
				repel: 30, linkDistance: 25, centering: 0.09,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 1.25,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
];

const SESSION_TRAIL_CAP = 200;
const USAGE_SAVE_DEBOUNCE_MS = 30_000;

export default class GraphInsightPlugin extends Plugin {
	settings: GraphInsightSettings = DEFAULT_SETTINGS;
	dataStore!: PluginDataStore;
	usageLog: UsageLog = emptyLog();
	sessionTrail: SessionEntry[] = [];

	private usageDirty = false;
	private dwellTimer: number | null = null;
	private saveUsageDebounced = debounce(() => this.flushUsage(), USAGE_SAVE_DEBOUNCE_MS, true);

	async onload(): Promise<void> {
		// Follow the app language. Must run before any view, command or settings
		// tab is built — those read their labels once, at construction time.
		initI18n(getLanguage());

		const saved = (await this.loadData()) as Partial<GraphInsightSettings> | null;
		// Deep-merge the panel so settings saved by older versions pick up
		// newly added fields (overlays, showBubbles) from defaults.
		this.settings = {
			...DEFAULT_SETTINGS,
			...(saved ?? {}),
			hoverPreview: { ...DEFAULT_SETTINGS.hoverPreview, ...(saved?.hoverPreview ?? {}) },
			chipFilter: { ...DEFAULT_SETTINGS.chipFilter, ...(saved?.chipFilter ?? {}) },
			panel: {
				...DEFAULT_SETTINGS.panel,
				...(saved?.panel ?? {}),
				channels: { ...DEFAULT_SETTINGS.panel.channels, ...(saved?.panel?.channels ?? {}) },
				overlays: { ...DEFAULT_SETTINGS.panel.overlays, ...(saved?.panel?.overlays ?? {}) },
				physics: { ...DEFAULT_SETTINGS.panel.physics, ...(saved?.panel?.physics ?? {}) },
				labels: { ...DEFAULT_SETTINGS.panel.labels, ...(saved?.panel?.labels ?? {}) },
				edges: { ...DEFAULT_SETTINGS.panel.edges, ...(saved?.panel?.edges ?? {}) },
				view3d: { ...DEFAULT_SETTINGS.panel.view3d, ...(saved?.panel?.view3d ?? {}) },
			},
		};
		// Softer-links migration: users still on the old stiff defaults get
		// the new feel; anyone who moved the sliders keeps their values.
		const physics = this.settings.panel.physics;
		this.settings = {
			...this.settings,
			panel: {
				...this.settings.panel,
				physics: {
					...physics,
					linkStrength: physics.linkStrength === 0.4 ? 0.15 : physics.linkStrength,
					velocityDecay: physics.velocityDecay === 0.4 ? 0.55 : physics.velocityDecay,
					// Compactness migration: only untouched old defaults move.
					repel: physics.repel === 50 || physics.repel === 40 ? 30 : physics.repel,
					linkDistance: physics.linkDistance === 40 ? 25 : physics.linkDistance,
					centering: physics.centering === 0.04 || physics.centering === 0.05 ? 0.09 : physics.centering,
				},
			},
		};
		// Seed/refresh the built-in view presets when the bundled set changes.
		// Retired defaults are dropped; new ones are added by name; the user's
		// own presets and any they still keep are preserved. The version guard
		// means deleting a default doesn't bring it back until the set changes.
		if ((this.settings.viewPresetsVersion ?? 0) < VIEW_PRESET_VERSION) {
			this.settings = {
				...this.settings,
				viewPresets: migrateViewPresets(
					this.settings.viewPresets,
					DEFAULT_VIEW_PRESETS,
					RETIRED_VIEW_PRESETS
				),
				viewPresetsVersion: VIEW_PRESET_VERSION,
			};
			await this.saveData(this.settings);
		}
		this.dataStore = new PluginDataStore(
			this.app,
			// The config folder is user-configurable — never hardcode ".obsidian".
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`
		);

		const loaded = await this.dataStore.loadUsage();
		this.usageLog = loaded ? compactLog(loaded, Date.now()) : emptyLog();

		this.registerView(GRAPH_INSIGHT_VIEW_TYPE, (leaf) => new GraphInsightView(leaf, this));
		this.registerView(INSIGHTS_VIEW_TYPE, (leaf) => new InsightsView(leaf, this));
		this.addSettingTab(new GraphInsightSettingsTab(this.app, this));

		this.addCommand({
			id: "open-graph",
			name: t("command.openView"),
			callback: () => void this.activateView(),
		});
		this.addRibbonIcon("git-fork", t("command.ribbon"), () => void this.activateView());

		this.addCommand({
			id: "focus-current-note",
			name: t("command.focusNote"),
			callback: async () => {
				const path = this.app.workspace.getActiveFile()?.path;
				if (!path) return;
				await this.activateView();
				this.getGraphView()?.focusOnPath(path);
			},
		});
		this.addCommand({
			id: "toggle-explore-mode",
			name: t("command.toggleExplore"),
			callback: async () => {
				await this.activateView();
				const view = this.getGraphView();
				if (!view) return;
				await (view.isExploring ? view.exitExplore() : view.enterExplore());
			},
		});
		// Panel toggles. Each one only makes sense with the graph on screen, so
		// they stay out of the palette while it is closed rather than silently
		// doing nothing.
		this.addPanelToggle("toggle-orphan-highlight", "command.toggleOrphans", (state) => ({
			...state,
			overlays: { ...state.overlays, orphans: !state.overlays.orphans },
		}));
		this.addPanelToggle("toggle-dead-ends", "command.toggleDeadEnds", (state) => ({
			...state,
			overlays: { ...state.overlays, deadEnds: !state.overlays.deadEnds },
		}));
		this.addPanelToggle("toggle-broken-links", "command.toggleBroken", (state) => ({
			...state,
			overlays: { ...state.overlays, broken: !state.overlays.broken },
		}));
		this.addPanelToggle("toggle-session-trail", "command.toggleTrail", (state) => ({
			...state,
			showTrail: !state.showTrail,
		}));
		this.addPanelToggle("toggle-timeline", "command.toggleTimeline", (state) => ({
			...state,
			showTimeline: !state.showTimeline,
		}));
		this.addPanelToggle("toggle-cluster-bubbles", "command.toggleBubbles", (state) => ({
			...state,
			showBubbles: !state.showBubbles,
		}));
		this.addPanelToggle("toggle-physics", "command.togglePhysics", (state) => ({
			...state,
			physics: { ...state.physics, disabled: !state.physics.disabled },
		}));
		this.addPanelToggle("toggle-3d", "command.toggle3d", (state) => ({
			...state,
			view3d: { ...state.view3d, enabled: !state.view3d.enabled },
		}));

		this.addCommand({
			id: "toggle-follow-active-note",
			name: t("command.toggleFollow"),
			checkCallback: (checking) => {
				const view = this.getGraphView();
				if (!view) return false;
				if (!checking) view.setFollowActiveNote(!this.settings.followActiveNote);
				return true;
			},
		});

		this.addCommand({
			id: "exit-focus-mode",
			name: t("command.exitFocus"),
			// Offered only while focus mode is actually on: otherwise the palette
			// lists an action with nothing to undo.
			checkCallback: (checking) => {
				const view = this.getGraphView();
				if (!view?.isFocused) return false;
				if (!checking) view.leaveFocus();
				return true;
			},
		});
		this.addCommand({
			id: "open-insights",
			name: t("command.openInsights"),
			callback: () => void this.activateInsights(),
		});
		this.addCommand({
			id: "export-png",
			name: t("command.exportPng"),
			callback: () => void this.getGraphView()?.exportPngFile(),
		});
		this.addCommand({
			id: "export-json",
			name: t("command.exportJson"),
			callback: () => this.getGraphView()?.exportJsonFile(),
		});
		this.addCommand({
			id: "export-gexf",
			name: t("command.exportGexf"),
			callback: () => this.getGraphView()?.exportGexfFile(),
		});

		this.registerEvent(this.app.workspace.on("file-open", (file) => this.handleFileOpen(file)));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.usageLog = renamePath(this.usageLog, oldPath, file.path);
					this.markUsageDirty();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.usageLog = removePath(this.usageLog, file.path);
				this.markUsageDirty();
			})
		);
	}

	private handleFileOpen(file: TFile | null): void {
		if (this.dwellTimer !== null) {
			window.clearTimeout(this.dwellTimer);
			this.dwellTimer = null;
		}
		if (!file || file.extension !== "md") return;

		const path = file.path;
		this.dwellTimer = window.setTimeout(() => {
			// Only count if the file is still the active one after the dwell.
			if (this.app.workspace.getActiveFile()?.path !== path) return;
			this.usageLog = recordOpen(this.usageLog, path, Date.now());
			this.sessionTrail = pushSessionEntry(
				this.sessionTrail,
				{ path, ts: Date.now() },
				SESSION_TRAIL_CAP
			);
			this.markUsageDirty();
		}, this.settings.openDwellSeconds * 1000);
	}

	private markUsageDirty(): void {
		this.usageDirty = true;
		this.saveUsageDebounced();
	}

	private async flushUsage(): Promise<void> {
		if (!this.usageDirty) return;
		this.usageDirty = false;
		await this.dataStore.saveUsage(this.usageLog);
	}

	async savePanelState(panel: PanelState): Promise<void> {
		this.settings = { ...this.settings, panel };
		await this.saveData(this.settings);
	}

	async setFollowActiveNote(followActiveNote: boolean): Promise<void> {
		this.settings = { ...this.settings, followActiveNote };
		await this.saveData(this.settings);
	}

	async saveChipFilter(chipFilter: { tags: string[]; folders: string[] }): Promise<void> {
		this.settings = { ...this.settings, chipFilter };
		await this.saveData(this.settings);
	}

	async savePresets(presets: SearchPreset[]): Promise<void> {
		this.settings = { ...this.settings, presets };
		await this.saveData(this.settings);
	}

	async saveViewPresets(viewPresets: ViewPreset[]): Promise<void> {
		this.settings = { ...this.settings, viewPresets };
		await this.saveData(this.settings);
	}

	/** Register a command that flips one field of the panel state. Hidden from
	 *  the palette while the graph view is closed — there is nothing to flip. */
	private addPanelToggle(
		id: string,
		nameKey: Parameters<typeof t>[0],
		mutate: (state: PanelState) => PanelState
	): void {
		this.addCommand({
			id,
			name: t(nameKey),
			checkCallback: (checking) => {
				const view = this.getGraphView();
				if (!view) return false;
				if (!checking) void view.updatePanelState(mutate);
				return true;
			},
		});
	}

	getGraphView(): GraphInsightView | null {
		const leaf = this.app.workspace.getLeavesOfType(GRAPH_INSIGHT_VIEW_TYPE)[0];
		return leaf ? (leaf.view as GraphInsightView) : null;
	}

	private async activateInsights(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(INSIGHTS_VIEW_TYPE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: INSIGHTS_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async markOnboardingShown(): Promise<void> {
		this.settings = { ...this.settings, onboardingShown: true };
		await this.saveData(this.settings);
	}

	private async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(GRAPH_INSIGHT_VIEW_TYPE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: GRAPH_INSIGHT_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	onunload(): void {
		if (this.dwellTimer !== null) window.clearTimeout(this.dwellTimer);
		void this.flushUsage();
	}
}
