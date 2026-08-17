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
import { InsightsView, INSIGHTS_VIEW_TYPE } from "./view/InsightsView";
import { LocalGraphView, LOCAL_GRAPH_VIEW_TYPE } from "./view/LocalGraphView";
import { GraphInsightSettingsTab } from "./settings/SettingsTab";
import { initI18n, t } from "./i18n";
import { migrateViewPresets } from "./view/presetNames";
import {
	DEFAULT_VIEW_PRESETS,
	RETIRED_VIEW_PRESETS,
	VIEW_PRESET_VERSION,
} from "./view/builtinPresets";
import {
	DEFAULT_SETTINGS,
	type GraphInsightSettings,
	type LocalGraphSettings,
	type OnboardingState,
} from "./settings/schema";
import { OnboardingModal } from "./ui/OnboardingModal";
import { normalizeSettings } from "./settings/normalize";
import type { PanelMode, PanelState } from "./ui/ControlPanel";
import type { SearchPreset } from "./ui/SearchBar";
import type { ViewPreset } from "./view/builtinPresets";

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

		// All migration and deep-merge logic lives in normalizeSettings so it
		// can be unit-tested against real old data.json payloads.
		this.settings = normalizeSettings(await this.loadData());
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
		this.registerView(LOCAL_GRAPH_VIEW_TYPE, (leaf) => new LocalGraphView(leaf, this));
		this.addSettingTab(new GraphInsightSettingsTab(this.app, this));

		this.addCommand({
			id: "open-graph",
			name: t("command.openView"),
			callback: () => void this.activateView(),
		});
		this.addRibbonIcon("git-fork", t("command.ribbon"), () => void this.activateView());

		this.addCommand({
			id: "show-onboarding",
			name: t("command.showOnboarding"),
			callback: () => this.showOnboarding(),
		});

		this.addCommand({
			id: "export-topic-map",
			name: t("topicmap.export"),
			checkCallback: (checking) => {
				const view = this.getGraphView();
				if (!view?.canExportTopicMap()) return false;
				if (!checking) view.exportCurrentTopicMap();
				return true;
			},
		});

		// F-01: one hotkey-able command per canned task.
		for (const action of GraphInsightView.TASK_ACTIONS) {
			this.addCommand({
				id: `task-${action.id}`,
				name: t(action.labelKey),
				callback: async () => {
					await this.activateView();
					this.getGraphView()?.runTask(action.id);
				},
			});
		}

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
			id: "open-local-graph",
			name: t("command.openLocalGraph"),
			callback: () => void this.activateLocalGraph(),
		});
		this.addCommand({
			id: "export-local-graph",
			name: t("command.exportLocalGraph"),
			checkCallback: (checking) => {
				const view = this.app.workspace.getLeavesOfType(LOCAL_GRAPH_VIEW_TYPE)[0]?.view;
				if (!(view instanceof LocalGraphView)) return false;
				if (!checking) void view.exportMarkdown();
				return true;
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
			id: "toggle-side-pane",
			name: t("command.toggleSidePane"),
			checkCallback: (checking) => {
				const view = this.getGraphView();
				if (!view) return false;
				if (!checking) view.setOpenInSidePane(!this.settings.openInSidePane);
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

	/**
	 * Swap the whole settings object — an import or a reset to defaults. An open
	 * graph is rebuilt from scratch, because nearly everything it holds (panel,
	 * presets, filters) has just been replaced underneath it.
	 */
	async replaceSettings(settings: GraphInsightSettings): Promise<void> {
		this.settings = settings;
		await this.saveData(this.settings);
		await this.getGraphView()?.reloadFromSettings();
	}

	async savePanelState(panel: PanelState): Promise<void> {
		this.settings = { ...this.settings, panel };
		await this.saveData(this.settings);
	}

	async saveLocalGraph(localGraph: LocalGraphSettings): Promise<void> {
		this.settings = { ...this.settings, localGraph };
		await this.saveData(this.settings);
	}

	async savePanelMode(panelMode: PanelMode): Promise<void> {
		this.settings = { ...this.settings, panelMode };
		await this.saveData(this.settings);
	}

	async setFollowActiveNote(followActiveNote: boolean): Promise<void> {
		this.settings = { ...this.settings, followActiveNote };
		await this.saveData(this.settings);
	}

	async setOpenInSidePane(openInSidePane: boolean): Promise<void> {
		this.settings = { ...this.settings, openInSidePane };
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

	async activateLocalGraph(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(LOCAL_GRAPH_VIEW_TYPE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: LOCAL_GRAPH_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async saveCollapsedSections(collapsed: { physics: boolean }): Promise<void> {
		this.settings = { ...this.settings, collapsedSections: collapsed };
		await this.saveData(this.settings);
	}

	async setOnboardingState(state: OnboardingState): Promise<void> {
		this.settings = { ...this.settings, onboardingState: state };
		await this.saveData(this.settings);
	}

	/** From Settings or the command palette — always opens, whatever the state. */
	showOnboarding(): void {
		new OnboardingModal(this.app, (result) => void this.setOnboardingState(result)).open();
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
