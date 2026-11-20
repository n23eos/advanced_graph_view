import { Plugin, TFile, debounce, getLanguage } from "obsidian";
import { GraphInsightView, GRAPH_INSIGHT_VIEW_TYPE } from "./view/GraphView";
import { findGraphView } from "./view/findGraphView";
import { LatestWriteQueue } from "./data/latestWriteQueue";
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
import { migratePhysicsDefaults, normalizeSettings } from "./settings/normalize";
import {
	applyRetention,
	buildSnapshot,
	emptySnapshotStore,
	shouldCapture,
	type SnapshotStore,
} from "./data/graphSnapshots";
import type { GraphMetrics } from "./workers/MetricsClient";
import type { GraphModel } from "./data/GraphStore";
import type { PanelMode, PanelState } from "./ui/ControlPanel";
import type { SearchPreset } from "./ui/SearchBar";
import type { ViewPreset } from "./view/builtinPresets";
import type { GraphAppearance } from "./settings/appearance";
import { createNewGraphViewState } from "./view/workspaceState";

const SESSION_TRAIL_CAP = 200;
const USAGE_SAVE_DEBOUNCE_MS = 30_000;
const SETTINGS_SAVE_DEBOUNCE_MS = 400;

export default class GraphInsightPlugin extends Plugin {
	settings: GraphInsightSettings = DEFAULT_SETTINGS;
	dataStore!: PluginDataStore;
	usageLog: UsageLog = emptyLog();
	sessionTrail: SessionEntry[] = [];

	private usageDirty = false;
	private usageWriter = new LatestWriteQueue<UsageLog>((log) => this.dataStore.saveUsage(log));
	private settingsWriter = new LatestWriteQueue<unknown>((data) => super.saveData(data));
	private settingsDirty = false;
	private graphViewReloadQueue: Promise<void> = Promise.resolve();
	private dwellTimer: number | null = null;
	private saveUsageDebounced = debounce(() => this.flushUsage(), USAGE_SAVE_DEBOUNCE_MS, true);
	private saveSettingsDebounced = debounce(() => this.flushSettings(), SETTINGS_SAVE_DEBOUNCE_MS, true);

	override saveData(data: unknown): Promise<void> {
		return this.settingsWriter.enqueue(data);
	}

	async onload(): Promise<void> {
		// Follow the app language. Must run before any view, command or settings
		// tab is built — those read their labels once, at construction time.
		initI18n(getLanguage());

		// All migration and deep-merge logic lives in normalizeSettings so it
		// can be unit-tested against real old data.json payloads.
		this.settings = normalizeSettings(await this.loadData());
		const previousPhysicsVersion = this.settings.physicsDefaultsVersion;
		this.settings = migratePhysicsDefaults(this.settings);
		let settingsMigrated = this.settings.physicsDefaultsVersion !== previousPhysicsVersion;
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
			settingsMigrated = true;
		}
		if (settingsMigrated) await this.saveData(this.settings);
		this.dataStore = new PluginDataStore(
			this.app,
			// The config folder is user-configurable — never hardcode ".obsidian".
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`
		);

		const loaded = await this.dataStore.loadUsage();
		this.usageLog = loaded ? compactLog(loaded, Date.now()) : emptyLog();

		this.registerHoverLinkSource(GRAPH_INSIGHT_VIEW_TYPE, { display: this.manifest.name, defaultMod: true });
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
			id: "open-changes",
			name: t("changes.open"),
			callback: async () => {
				await this.activateView();
				this.getGraphView()?.toggleChangesPanel();
			},
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
			checkCallback: (checking) => {
				const view = this.getGraphView();
				if (!view) return false;
				if (!checking) void view.exportPngFile();
				return true;
			},
		});
		this.addCommand({
			id: "export-json",
			name: t("command.exportJson"),
			checkCallback: (checking) => {
				const view = this.getGraphView();
				if (!view) return false;
				if (!checking) view.exportJsonFile();
				return true;
			},
		});
		this.addCommand({
			id: "export-gexf",
			name: t("command.exportGexf"),
			checkCallback: (checking) => {
				const view = this.getGraphView();
				if (!view) return false;
				if (!checking) view.exportGexfFile();
				return true;
			},
		});

		this.registerEvent(this.app.workspace.on("quit", (tasks) => {
			tasks.add(async () => {
				await Promise.all([this.flushUsage(), this.flushSettings()]);
			});
			const view = this.getGraphView();
			if (view) tasks.add(() => view.flushPositions());
		}));
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
		if (this.usageDirty) {
			this.usageDirty = false;
			await this.usageWriter.enqueue(this.usageLog);
		} else {
			await this.usageWriter.flush();
		}
	}

	/**
	 * Swap the whole settings object — an import or a reset to defaults. An open
	 * graph is rebuilt from scratch, because nearly everything it holds (panel,
	 * presets, filters) has just been replaced underneath it.
	 */
	async replaceSettings(settings: GraphInsightSettings): Promise<void> {
		this.settings = settings;
		await this.saveData(this.settings);
		await this.reloadGraphViews(settings.appearance);
	}

	async savePanelState(panel: PanelState, appearance: GraphAppearance = this.settings.appearance): Promise<void> {
		this.settings = { ...this.settings, panel, appearance };
		this.settingsDirty = true;
		this.saveSettingsDebounced();
	}

	async flushSettings(): Promise<void> {
		this.saveSettingsDebounced.cancel();
		if (!this.settingsDirty) {
			await this.settingsWriter.flush();
			return;
		}
		this.settingsDirty = false;
		try {
			await this.saveData(this.settings);
		} catch (error) {
			this.settingsDirty = true;
			throw error;
		}
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
		return findGraphView(this.app.workspace.getLeavesOfType(GRAPH_INSIGHT_VIEW_TYPE));
	}

	async reloadGraphViews(appearance?: GraphAppearance): Promise<void> {
		const performReload = async () => {
			const leaves = [
				...this.app.workspace.getLeavesOfType(GRAPH_INSIGHT_VIEW_TYPE),
				...this.app.workspace.getLeavesOfType(LOCAL_GRAPH_VIEW_TYPE),
				...this.app.workspace.getLeavesOfType(INSIGHTS_VIEW_TYPE),
			];
			let failed = false;
			let firstError: unknown;
			for (const { view } of leaves) {
				if (!(view instanceof GraphInsightView || view instanceof LocalGraphView || view instanceof InsightsView)) continue;
				try {
					if (view instanceof InsightsView) await view.reloadFromSettings();
					else await view.reloadFromSettings(appearance);
				} catch (error) {
					if (!failed) firstError = error;
					failed = true;
				}
			}
			if (failed) throw firstError;
		};
		const reload = this.graphViewReloadQueue.then(performReload, performReload);
		this.graphViewReloadQueue = reload;
		return reload;
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
		await leaf.setViewState({
			type: LOCAL_GRAPH_VIEW_TYPE,
			active: true,
			state: createNewGraphViewState({
				...this.settings.panel,
				view3d: {
					...this.settings.panel.view3d,
					enabled: this.settings.localGraph.view3d,
				},
			}),
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	/** F-10 history; loaded lazily, appended after successful metrics. */
	snapshotStore: SnapshotStore = emptySnapshotStore();

	private snapshotsReady: Promise<void> | null = null;
	private snapshotsAreLoaded = false;
	private snapshotGeneration = 0;
	private snapshotCapture: Promise<void> | null = null;
	private snapshotReset: Promise<void> | null = null;
	get snapshotsLoaded(): boolean {
		return this.snapshotsAreLoaded;
	}

	ensureSnapshots(): Promise<void> {
		if (!this.snapshotsReady) {
			const generation = this.snapshotGeneration;
			const ready = this.dataStore.loadSnapshots()
				.then((loaded) => {
					if (generation === this.snapshotGeneration) {
						this.snapshotStore = loaded ?? emptySnapshotStore();
						this.snapshotsAreLoaded = true;
					}
				})
				.catch((error: unknown) => {
					if (this.snapshotsReady === ready) this.snapshotsReady = null;
					throw error;
				});
			this.snapshotsReady = ready;
		}
		return this.snapshotsReady;
	}

	/** Called by the view after a successful metrics run — the only moment a
	 *  snapshot may be captured, and at most once per 24 h. */
	async maybeCaptureSnapshot(model: GraphModel, metrics: GraphMetrics): Promise<void> {
		const generation = this.snapshotGeneration;
		await this.ensureSnapshots();
		if (generation !== this.snapshotGeneration || this.snapshotReset || this.snapshotCapture) return;
		const now = Date.now();
		if (!shouldCapture(this.snapshotStore, now, model.scope)) return;
		const capture = (async () => {
			const next = applyRetention(
				{ version: 1, snapshots: [...this.snapshotStore.snapshots, buildSnapshot(model, metrics, now)] },
				now
			);
			this.snapshotStore = next;
			await this.dataStore.saveSnapshots(next);
		})();
		this.snapshotCapture = capture;
		try {
			await capture;
		} finally {
			if (this.snapshotCapture === capture) this.snapshotCapture = null;
		}
	}

	async resetSnapshots(): Promise<void> {
		if (this.snapshotReset) return this.snapshotReset;
		this.snapshotGeneration++;
		this.snapshotStore = emptySnapshotStore();
		this.snapshotsAreLoaded = true;
		this.snapshotsReady = Promise.resolve();
		const capture = this.snapshotCapture;
		const reset = (async () => {
			if (capture) await capture.catch(() => undefined);
			await this.dataStore.removeSnapshots();
		})();
		this.snapshotReset = reset;
		try {
			await reset;
		} finally {
			if (this.snapshotReset === reset) this.snapshotReset = null;
		}
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
		await leaf.setViewState({
			type: GRAPH_INSIGHT_VIEW_TYPE,
			active: true,
			state: createNewGraphViewState(this.settings.panel),
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	onunload(): void {
		if (this.dwellTimer !== null) window.clearTimeout(this.dwellTimer);
		void this.flushUsage();
		void this.flushSettings();
	}
}
