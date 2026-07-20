import { Plugin, TFile, debounce } from "obsidian";
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
import { SemanticService } from "./semantic/SemanticService";
import { InsightsView, INSIGHTS_VIEW_TYPE } from "./view/InsightsView";
import { GraphInsightSettingsTab } from "./settings/SettingsTab";

export interface SemanticSettings {
	enabled: boolean;
	threshold: number;
	showEdges: boolean;
}

interface GraphInsightSettings {
	panel: PanelState;
	presets: SearchPreset[];
	semantics: SemanticSettings;
	onboardingShown: boolean;
	/** Open counts only when the file stays active at least this long. */
	openDwellSeconds: number;
}

const DEFAULT_SETTINGS: GraphInsightSettings = {
	panel: {
		channels: { size: "pagerank", color: "recency-edit", glow: null },
		colorPreset: "recency",
		collapsed: false,
		overlays: { orphans: false, deadEnds: false, broken: false },
		showBubbles: false,
		showTimeline: false,
		showTrail: false,
		physics: {
			repel: 30, linkDistance: 25, centering: 0.09,
			linkStrength: 0.15, velocityDecay: 0.55, freeLayout: false,
		},
		labels: { fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
		edges: { show: true, width: 1, opacity: 0.25 },
		nodeScale: 1,
		view3d: { enabled: false, depthSource: "physics", focal: 900 },
		colorTuning: { preset: "recency", useCustom: false, customFrom: "#4a5568", customTo: "#f6ad55", gamma: 1 },
	},
	openDwellSeconds: 5,
	presets: [],
	semantics: { enabled: false, threshold: 0.75, showEdges: true },
	onboardingShown: false,
};

const SESSION_TRAIL_CAP = 200;
const USAGE_SAVE_DEBOUNCE_MS = 30_000;

export default class GraphInsightPlugin extends Plugin {
	settings: GraphInsightSettings = DEFAULT_SETTINGS;
	dataStore!: PluginDataStore;
	semantics!: SemanticService;
	usageLog: UsageLog = emptyLog();
	sessionTrail: SessionEntry[] = [];

	private usageDirty = false;
	private dwellTimer: number | null = null;
	private saveUsageDebounced = debounce(() => this.flushUsage(), USAGE_SAVE_DEBOUNCE_MS, true);

	async onload(): Promise<void> {
		const saved = (await this.loadData()) as Partial<GraphInsightSettings> | null;
		// Deep-merge the panel so settings saved by older versions pick up
		// newly added fields (overlays, showBubbles) from defaults.
		this.settings = {
			...DEFAULT_SETTINGS,
			...(saved ?? {}),
			panel: {
				...DEFAULT_SETTINGS.panel,
				...(saved?.panel ?? {}),
				channels: { ...DEFAULT_SETTINGS.panel.channels, ...(saved?.panel?.channels ?? {}) },
				overlays: { ...DEFAULT_SETTINGS.panel.overlays, ...(saved?.panel?.overlays ?? {}) },
				physics: { ...DEFAULT_SETTINGS.panel.physics, ...(saved?.panel?.physics ?? {}) },
				labels: { ...DEFAULT_SETTINGS.panel.labels, ...(saved?.panel?.labels ?? {}) },
				edges: { ...DEFAULT_SETTINGS.panel.edges, ...(saved?.panel?.edges ?? {}) },
				view3d: { ...DEFAULT_SETTINGS.panel.view3d, ...(saved?.panel?.view3d ?? {}) },
				colorTuning: { ...DEFAULT_SETTINGS.panel.colorTuning, ...(saved?.panel?.colorTuning ?? {}) },
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
			semantics: { ...DEFAULT_SETTINGS.semantics, ...(saved?.semantics ?? {}) },
		};
		this.dataStore = new PluginDataStore(this.app, this.manifest.dir ?? ".obsidian/plugins/graph-insight");

		const loaded = await this.dataStore.loadUsage();
		this.usageLog = loaded ? compactLog(loaded, Date.now()) : emptyLog();

		this.semantics = new SemanticService(this.app, this.dataStore);
		if (this.settings.semantics.enabled) {
			// Consent already given previously; model is cached.
			void this.semantics.enable();
		}
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (this.settings.semantics.enabled) this.semantics.scheduleReindex(file);
			})
		);

		this.registerView(GRAPH_INSIGHT_VIEW_TYPE, (leaf) => new GraphInsightView(leaf, this));
		this.registerView(INSIGHTS_VIEW_TYPE, (leaf) => new InsightsView(leaf, this));
		this.addSettingTab(new GraphInsightSettingsTab(this.app, this));

		this.addCommand({
			id: "open-graph",
			name: "Open Graph Insight",
			callback: () => this.activateView(),
		});
		this.addRibbonIcon("git-fork", "Open Graph Insight", () => this.activateView());

		this.addCommand({
			id: "focus-current-note",
			name: "Focus current note in graph",
			callback: async () => {
				const path = this.app.workspace.getActiveFile()?.path;
				if (!path) return;
				await this.activateView();
				this.getGraphView()?.focusOnPath(path);
			},
		});
		this.addCommand({
			id: "toggle-semantic-edges",
			name: "Toggle semantic edges",
			callback: () => {
				const next = { ...this.settings.semantics, showEdges: !this.settings.semantics.showEdges };
				void this.saveSemanticSettings(next);
				this.getGraphView()?.refreshFromSettings();
			},
		});
		this.addCommand({
			id: "toggle-orphan-highlight",
			name: "Toggle orphan highlight",
			callback: () => void this.getGraphView()?.updatePanelState((state) => ({
				...state,
				overlays: { ...state.overlays, orphans: !state.overlays.orphans },
			})),
		});
		this.addCommand({
			id: "toggle-session-trail",
			name: "Toggle session trail",
			callback: () => void this.getGraphView()?.updatePanelState((state) => ({
				...state,
				showTrail: !state.showTrail,
			})),
		});
		this.addCommand({
			id: "rebuild-embeddings",
			name: "Rebuild embeddings index",
			callback: () => void this.semantics.rebuild(),
		});
		this.addCommand({
			id: "open-insights",
			name: "Open Insights dashboard",
			callback: () => void this.activateInsights(),
		});
		this.addCommand({
			id: "export-png",
			name: "Export current view as PNG",
			callback: () => void this.getGraphView()?.exportPngFile(),
		});
		this.addCommand({
			id: "export-json",
			name: "Export graph data as JSON",
			callback: () => this.getGraphView()?.exportJsonFile(),
		});
		this.addCommand({
			id: "export-gexf",
			name: "Export graph data as GEXF",
			callback: () => this.getGraphView()?.exportGexfFile(),
		});

		this.registerEvent(this.app.workspace.on("file-open", (file) => this.handleFileOpen(file)));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.usageLog = renamePath(this.usageLog, oldPath, file.path);
					this.markUsageDirty();
					this.semantics.handleRename(oldPath, file.path);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.usageLog = removePath(this.usageLog, file.path);
				this.markUsageDirty();
				this.semantics.handleDelete(file.path);
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

	async savePresets(presets: SearchPreset[]): Promise<void> {
		this.settings = { ...this.settings, presets };
		await this.saveData(this.settings);
	}

	async saveSemanticSettings(semantics: SemanticSettings): Promise<void> {
		this.settings = { ...this.settings, semantics };
		await this.saveData(this.settings);
	}

	getGraphView(): GraphInsightView | null {
		const leaf = this.app.workspace.getLeavesOfType(GRAPH_INSIGHT_VIEW_TYPE)[0];
		return leaf ? (leaf.view as GraphInsightView) : null;
	}

	private async activateInsights(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(INSIGHTS_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: INSIGHTS_VIEW_TYPE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	async markOnboardingShown(): Promise<void> {
		this.settings = { ...this.settings, onboardingShown: true };
		await this.saveData(this.settings);
	}

	private async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(GRAPH_INSIGHT_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: GRAPH_INSIGHT_VIEW_TYPE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	onunload(): void {
		if (this.dwellTimer !== null) window.clearTimeout(this.dwellTimer);
		this.semantics.disable();
		void this.flushUsage();
	}
}
