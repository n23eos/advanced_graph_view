import { NativeHoverPreview } from "./nativeHoverPreview";
import { ExploreBindings } from "./exploreBindings";
import { TooltipController } from "./tooltip";
import { ChangesController } from "./changesController";
import { ExportActions } from "./exportActions";
import { GraphMenus } from "./menus";
import { NoteNavigation, type FileExplorerView } from "./noteNavigation";
import { PresetActions } from "./presetActions";
import { observeRendererVisibility } from "./rendererVisibility";
import { panelDiff } from "./panelDiff";
import {
	ItemView,
	Keymap,
	Notice,
	TFile,
	debounce,
	getAllTags,
	type EventRef,
	type Events,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import { buildAdjacency, computeDistances, focusFalloff, shortestPath, type Adjacency } from "../analysis/focus";
import { nameClusters, type ClusterContent } from "../analysis/clusterNames";
import { computeOverlayMask, countOverlayMatches } from "../analysis/overlays";
import { buildGraphModel, sameGraphModel, type GraphModel } from "../data/GraphStore";
import { consumeRenames, recordRename, remapPinnedPaths, resolvePreviousPath } from "./renamedPaths";
import { buildNeighborSeed, type SeedPosition } from "./neighborSeed";
import { carryMetrics, diffFacts } from "./factsRefresh";
import { countRecentOpens } from "../data/UsageTracker";
import { LatestWriteQueue } from "../data/latestWriteQueue";
import type { PositionMap, SavedPositions } from "../data/persistence";
import { buildEncoding, type NodeEncoding } from "../encoding/encode";
import { categoryColor } from "../encoding/colorScales";
import { activePreset, isLightTheme } from "../render/theme";
import { effectiveNodeStyle } from "../render/nodeStyle";
import type { NodeFacts } from "../encoding/metrics";
import { collectPropertyKeys, normalizeFrontmatterProperties } from "../encoding/frontmatterProperties";
import type { ExploreSession } from "../explore/ExploreSession";
import { motionMs, prefersReducedMotion } from "../render/motion";
import { GraphRenderer } from "../render/GraphRenderer";
import { ControlPanel, type PanelState } from "../ui/ControlPanel";
import { Legend } from "../ui/Legend";
import { LayoutClient } from "../workers/LayoutClient";
import { AutoFitGate, shouldFitOnSettle } from "./autoFitGate";
import { adaptPhysicsToGraphSize } from "../ui/layoutDensity";
import type { LayoutRule, PhysicsParams } from "../workers/layoutEngine";
import { formatPhysicsDiff, physicsDiff, recommendedPhysics } from "../ui/physicsReset";
import { responsiveMode, type ResponsiveMode } from "../ui/responsive";
import { FloatingLayout } from "../ui/FloatingLayout";
import { renderGraphStartupError } from "../ui/GraphStartupError";
import { NavigationTrail } from "../explore/navigationTrail";
import { renderBreadcrumb } from "../ui/breadcrumb";
import type { TopicMapSource } from "../export/topicMapMarkdown";
import type { ChangesPanel, ChangesData } from "../ui/ChangesPanel";
import type { ChangesClient } from "../workers/ChangesClient";
import type { ChangeCategory, LinkChange } from "../analysis/graphChanges";
import { MetricsClient, type GraphMetrics } from "../workers/MetricsClient";
import {
	contentNeedles, parseQuery, matchesQuery, validateQuery,
	type ParsedQuery, type QueryDiagnostic,
} from "../query/QueryParser";
import { sortSearchPresets } from "../settings/searchPresets";
import { SearchBar, type SearchConstraint, type SearchMode } from "../ui/SearchBar";
import { FilterChips, type FilterSelection } from "../ui/FilterChips";
import { compileChipFilter } from "../ui/chipFilter";
import type { ExploreNoteModal } from "../ui/ExploreNoteModal";
import { PromptModal } from "../ui/PromptModal";
import { TimelineBar, type TimelineMode } from "../ui/TimelineBar";
import { CameraWidget } from "../ui/CameraWidget";
import { ToolBar, type CursorTool } from "../ui/ToolBar";
import { computeGroups, depthByAge, depthByCluster } from "./layoutGrouping";
import { presetDisplayName } from "./presetNames";
import { resolveFollowAction } from "./followActiveNote";
import {
	normalizeGraphViewState,
	type CameraState,
} from "./workspaceState";
import { t } from "../i18n";
import type GraphInsightPlugin from "../main";
import type { ViewPreset } from "./builtinPresets";

export const GRAPH_INSIGHT_VIEW_TYPE = "graph-insight-view";

const POSITION_SAVE_DEBOUNCE_MS = 5000;
const WORKSPACE_SAVE_DEBOUNCE_MS = 300;
/** How long the session trail takes to redraw itself end to end. */
const TRAIL_REPLAY_MS = 4000;
/** World-unit collision radius at nodeScale 1. 0 = no size-based repulsion
 *  (nodes may overlap; layout spacing comes from charge + links only). */
const COLLIDE_BASE_RADIUS = 0;
/** How dim the rest of the graph goes while explore mode is running. Low
 *  enough to read as backdrop: the notes you can travel to must be the only
 *  thing competing for attention. */
const EXPLORE_BACKGROUND_ALPHA = 0.05;

export class GraphInsightView extends ItemView {
	private nativeHoverPreview: NativeHoverPreview | null = null;
	private exploreBindingsController?: ExploreBindings;
	private get exploreBindings(): ExploreBindings {
		return this.exploreBindingsController ??= new ExploreBindings({
			getApp: () => this.app,
			getRenderer: () => this.renderer,
			getModel: () => this.model,
			getExploreSession: () => this.exploreSession,
			setExploreSession: (value) => { this.exploreSession = value; },
			getExploreDetached: () => this.exploreDetached,
			setExploreDetached: (value) => { this.exploreDetached = value; },
			getExploreTrail: () => this.exploreTrail,
			setExploreTrail: (value) => { this.exploreTrail = value; },
			getExploreOverride: () => this.exploreOverride,
			setExploreOverride: (value) => { this.exploreOverride = value; },
			getFocusRootId: () => this.focusRootId,
			getTooltip: () => this.tooltip,
			getExploreFocus: () => this.exploreFocus,
			setExploreFocus: (value) => { this.exploreFocus = value; },
			getViewWindow: () => this.viewWindow,
			getCameraWidget: () => this.cameraWidget,
			getExploreNoteModal: () => this.exploreNoteModal,
			setExploreNoteModal: (value) => { this.exploreNoteModal = value; },
			getFocusBar: () => this.focusBar,
			getRebuildDeferred: () => this.rebuildDeferred,
			setRebuildDeferred: (value) => { this.rebuildDeferred = value; },
			getPlugin: () => this.plugin,
			getTooltipNodeId: () => this.tooltipNodeId,
			setTooltipNodeId: (value) => { this.tooltipNodeId = value; },
			getContentEl: () => this.contentEl,
			getIsExploring: () => this.isExploring,
			getHiddenMask: () => this.hiddenMask,
			applyExploreOverride: () => this.applyExploreOverride(),
			exitFocus: () => this.exitFocus(),
			clearPreviewTimer: () => this.clearPreviewTimer(),
			graphAdjacency: () => this.graphAdjacency(),
			recomputeVisual: () => this.recomputeVisual(),
			renderExploreBar: () => this.renderExploreBar(),
			showExploreTarget: (nodeId, clientX, clientY) => this.showExploreTarget(nodeId, clientX, clientY),
			applyAllPanelState: (state, prev) => this.applyAllPanelState(state, prev),
			rebuildGraph: () => this.rebuildGraph(),
			enterExplore: (startId) => this.enterExplore(startId),
			navigateExploreTo: (nodeId) => this.navigateExploreTo(nodeId),
			openExploreNotePicker: () => this.openExploreNotePicker(),
			openNode: (nodeId, newTab) => this.openNode(nodeId, newTab),
			previousExploreIndex: () => this.previousExploreIndex(),
			exploreBack: () => this.exploreBack(),
			detachExplore: () => this.detachExplore(),
			openTopicMapExport: (source, rootId, flatIds) => this.openTopicMapExport(source, rootId, flatIds),
			exitExplore: () => this.exitExplore(),
			renderTrail: (host, trail, go) => this.renderTrail(host, trail, go),
		});
	}

	private tooltipController?: TooltipController;
	private get tooltipActions(): TooltipController {
		return this.tooltipController ??= new TooltipController({
			getApp: () => this.app,
			getContentEl: () => this.contentEl,
			getFacts: () => this.facts,
			getModel: () => this.model,
			getOpenGeneration: () => this.openGeneration,
			getPlugin: () => this.plugin,
			getPreviewTimer: () => this.previewTimer,
			setPreviewTimer: (value) => { this.previewTimer = value; },
			getTooltip: () => this.tooltip,
			setTooltip: (value) => { this.tooltip = value; },
			getTooltipNodeId: () => this.tooltipNodeId,
			setTooltipNodeId: (value) => { this.tooltipNodeId = value; },
			getViewWindow: () => this.viewWindow,
			clearPreviewTimer: () => this.clearPreviewTimer(),
			appendNotePreview: (nodeId, words) => this.appendNotePreview(nodeId, words),
			notePreview: (nodeId, words) => this.notePreview(nodeId, words),
		});
	}

	private changesController?: ChangesController;
	private get changesActions(): ChangesController {
		return this.changesController ??= new ChangesController({
			getChangesPanel: () => this.changesPanel,
			setChangesPanel: (value) => { this.changesPanel = value; },
			getChangesClient: () => this.changesClient,
			setChangesClient: (value) => { this.changesClient = value; },
			getChangesData: () => this.changesData,
			setChangesData: (value) => { this.changesData = value; },
			getChangesGeneration: () => this.changesGeneration,
			setChangesGeneration: (value) => { this.changesGeneration = value; },
			getChangesHighlight: () => this.changesHighlight,
			setChangesHighlight: (value) => { this.changesHighlight = value; },
			getChangesSelection: () => this.changesSelection,
			setChangesSelection: (value) => { this.changesSelection = value; },
			getClosing: () => this.closing,
			getClusterNames: () => this.clusterNames,
			getContentEl: () => this.contentEl,
			getFacts: () => this.facts,
			getMetrics: () => this.metrics,
			getModel: () => this.model,
			getPathDrawn: () => this.pathDrawn,
			setPathDrawn: (value) => { this.pathDrawn = value; },
			getPlugin: () => this.plugin,
			getRenderer: () => this.renderer,
			ensureChangesPanel: () => this.ensureChangesPanel(),
			refreshChanges: () => this.refreshChanges(),
			selectChangesCategory: (category) => this.selectChangesCategory(category),
			openNode: (nodeId, newTab) => this.openNode(nodeId, newTab),
			focusChangesLink: (link) => this.focusChangesLink(link),
			clusterNodeIds: (communityId) => this.clusterNodeIds(communityId),
			applyChangesMask: () => this.applyChangesMask(),
			recomputeVisual: () => this.recomputeVisual(),
		});
	}

	private exportController?: ExportActions;
	private get exportActions(): ExportActions {
		return this.exportController ??= new ExportActions({
			getApp: () => this.app,
			getRenderer: () => this.renderer,
			getModel: () => this.model,
			getMetrics: () => this.metrics,
			getHiddenClusters: () => this.hiddenClusters,
			getFocusRootId: () => this.focusRootId,
			getExploreFocus: () => this.exploreFocus,
			getFocusDepth: () => this.focusDepth,
			getViewDocument: () => this.viewDocument,
			getViewWindow: () => this.viewWindow,
			getContentEl: () => this.contentEl,
		});
	}
	private menuController?: GraphMenus<(typeof GraphInsightView.TASK_ACTIONS)[number]["id"]>;
	private get menus(): GraphMenus<(typeof GraphInsightView.TASK_ACTIONS)[number]["id"]> {
		return this.menuController ??= new GraphMenus({
			getModel: () => this.model,
			getHiddenNodes: () => this.hiddenNodes,
			setHiddenNodeCount: (count) => this.panel?.setHiddenNodeCount(count),
			recomputeVisual: () => this.recomputeVisual(),
			openNode: (nodeId, newTab) => this.openNode(nodeId, newTab),
			openNodeInSplit: (nodeId) => this.openNodeInSplit(nodeId),
			canRevealNode: () => this.fileExplorer() !== null,
			revealNode: (nodeId) => this.revealNode(nodeId),
			enterFocus: (nodeId) => this.enterFocus(nodeId),
			enterExplore: (nodeId) => void this.enterExplore(nodeId),
			isPinned: (nodeId) => this.isPinned(nodeId),
			togglePin: (nodeId) => { this.togglePin(nodeId); },
			setSelectionPinned: (nodeIds, pinned) => this.setSelectionPinned(nodeIds, pinned),
			exportLasso: (nodeIds) => this.openTopicMapExport("lasso", null, nodeIds),
			writeClipboard: (text) => navigator.clipboard.writeText(text),
			getTaskActions: () => GraphInsightView.TASK_ACTIONS,
			runTask: (taskId) => this.runTask(taskId),
			getFollowActiveNote: () => this.plugin.settings.followActiveNote,
			setFollowActiveNote: (enabled) => void this.plugin.setFollowActiveNote(enabled),
			getOpenInSidePane: () => this.plugin.settings.openInSidePane,
			setOpenInSidePane: (enabled) => void this.plugin.setOpenInSidePane(enabled),
			activateLocalGraph: () => void this.plugin.activateLocalGraph(),
			fitAll: () => this.renderer?.fitAll(),
			resetCamera: () => this.renderer?.resetCamera(),
			getIsExploring: () => this.isExploring,
			toggleExplore: () => void (this.exploreSession ? this.exitExplore() : this.enterExplore()),
			openPresetManager: () => this.openPresetManager(),
			toggleChangesPanel: () => this.toggleChangesPanel(),
		});
	}
	private noteNavigationController?: NoteNavigation;
	private get noteNavigation(): NoteNavigation {
		return this.noteNavigationController ??= new NoteNavigation({
			getApp: () => this.app,
			getLeaf: () => this.leaf,
			getModel: () => this.model,
			getOpenInSidePane: () => this.plugin.settings.openInSidePane,
			setSelfOpenedPath: (path) => { this.selfOpenedPath = path; },
			getCompanionLeafId: () => this.companionLeafId,
			setCompanionLeafId: (id) => { this.companionLeafId = id; },
		});
	}
	private presetController?: PresetActions;
	private get presetActions(): PresetActions {
		return this.presetController ??= new PresetActions({
			getApp: () => this.app,
			getSearchPresets: () => this.plugin.settings.presets,
			saveSearchPresets: (presets) => this.plugin.savePresets(presets),
			setSearchPresets: (presets) => this.searchBar?.setPresets(presets),
			applySearchQuery: (query) => this.searchBar?.applyQuery(query),
			getViewPresets: () => this.plugin.settings.viewPresets,
			getPanelState: () => this.plugin.settings.panel,
			saveViewPresets: (presets) => this.plugin.saveViewPresets(presets),
			setViewPresets: (presets) => this.panel?.setViewPresets(this.presetRows(presets)),
			setSelectedViewPreset: (index) => this.panel?.setSelectedPreset(index),
			setActivePresetIndex: (index) => { this.activePresetIndex = index; },
			clearPhysicsUndo: () => { this.physicsUndo = null; },
			requestAutoFit: () => this.autoFit.request(),
			updatePanelState: (mutate) => this.updatePanelState(mutate),
			selectLinksTool: () => this.toolBar?.selectTool("links"),
			clearHardQueryForTask: () => this.clearHardQueryForTask(),
		});
	}

	private renderer: GraphRenderer | null = null;
	private stopObservingRendererVisibility: (() => void) | null = null;
	private viewWindow: Window | null = null;
	private viewDocument: Document | null = null;
	private resizeFrame: number | null = null;
	private layout: LayoutClient | null = null;
	/** Frames the graph after the first layout and after a preset switch. */
	private readonly autoFit = new AutoFitGate();
	private metricsClient: MetricsClient | null = null;
	private model: GraphModel | null = null;
	private hasLayoutPositions = false;
	private positionWriter = new LatestWriteQueue<SavedPositions>((saved) => this.plugin.dataStore.savePositions(saved));
	private facts: NodeFacts[] = [];
	private encoding: NodeEncoding | null = null;
	private metrics: GraphMetrics | null = null;
	private clusterNames: string[] = [];
	/** Cluster indexes (into sorted cluster rows) map to community ids. */
	private clusterOrder: number[] = [];
	private hiddenClusters = new Set<number>();
	private hiddenNodes = new Set<number>();
	/** Temporary pins left behind by dragging (released on regroup). */
	private pinnedNodes = new Set<number>();
	/** Explicit «Закрепить позицию» pins — survive regrouping. */
	private explicitPins = new Set<number>();
	/** Last mask handed to the renderer: 1 = filtered out. Read by the follow
	 *  handler, which must not chase a note the user has filtered away. */
	private hiddenMask: Uint8Array | null = null;
	/** Path the graph itself just opened, so following can skip its own moves. */
	private selfOpenedPath: string | null = null;
	private tooltip: HTMLElement | null = null;
	/** Node the tooltip currently describes; guards async preview reads and
	 *  avoids rebuilding the tooltip on every same-node pointermove. */
	private tooltipNodeId: number | null = null;
	/** Pending delayed-preview timer, so a quick sweep across nodes never reads. */
	private previewTimer: number | null = null;
	/** View preset currently shown as applied in the panel dropdown. */
	private activePresetIndex: number | null = null;
	private panel: ControlPanel | null = null;
	/** needle → set of matching paths, built lazily on Enter. */
	private contentIndex = new Map<string, Set<string>>();
	private contentIndexGeneration = 0;
	private visualFrame: number | null = null;
	private legend: Legend | null = null;
	/** Pane beside the graph that notes open into while side-pane mode is on.
	 *  Remembered by id, not by object: Obsidian can rebuild the leaf behind
	 *  the same id, and a stale object reference made every click split again. */
	private companionLeafId: string | null = null;
	/** Placeholder shown instead of a blank canvas when the vault has no notes. */
	private emptyState: HTMLElement | null = null;
	/** Distinguishes an empty result from a genuinely empty vault. */
	private filteredEmptyState: HTMLElement | null = null;
	private searchBar: SearchBar | null = null;
	private filterChips: FilterChips | null = null;
	/** Tag/folder picks from the dedicated dropdowns (OR inside, AND across). */
	private chipFilter: FilterSelection = { tags: new Set(), folders: new Set() };
	private focusBar: HTMLElement | null = null;
	private toolBar: ToolBar | null = null;
	private cursorTool: CursorTool = "open";
	/** First endpoint picked in «Путь» mode. */
	private pathAnchor: number | null = null;
	/** True while a found route is drawn, so Esc knows there is one to clear
	 *  (the anchor is already consumed by the time the path shows). */
	private pathDrawn = false;

	/** Live (soft) query while typing; matched=1, others dimmed. */
	private softQuery: ParsedQuery | null = null;
	/** Committed (Enter) query: non-matches are hidden entirely. */
	private hardQuery: ParsedQuery | null = null;
	/** Text of the committed query, shown as the removable chip. */
	private hardQueryText = "";
	/** Last commit's syntax problem; the previous valid filter stays applied. */
	private searchParseError: QueryDiagnostic | undefined;
	/** In-flight content index scans; > 0 renders "Indexing…". */
	private contentIndexJobs = 0;
	/** Counts from the last recomputeVisual pass, reused by pushSearchUi. */
	private searchCounts = { softMatched: 0, visible: 0, total: 0 };
	private focusRootId: number | null = null;
	private focusDepth = 2;
	private adjacencyCache: { model: GraphModel; value: Adjacency } | null = null;
	private focusDistanceCache: { model: GraphModel; rootId: number; depth: number; value: Int16Array } | null = null;
	private timeline: TimelineBar | null = null;
	private cameraWidget: CameraWidget | null = null;
	private timelineCutoff: number | null = null;
	private timelineMode: TimelineMode = "created";
	private trailReplayFrame: number | null = null;
	/** Explore mode: null when off. */
	private exploreSession: ExploreSession | null = null;
	/** Node under the camera + its links, so the rest of the graph can dim. */
	private exploreFocus: { centerId: number; neighbors: readonly number[] } | null = null;
	/** Explore mode is forcing 3D on and physics off — at runtime only, never
	 *  written to the saved settings. */
	private exploreOverride = false;
	/** Explore mode is running but not anchored to a node: the whole graph is
	 *  readable again and a click picks the next place to explore from. */
	private exploreDetached = false;
	private exploreNoteModal: ExploreNoteModal | null = null;
	/** A vault change arrived while exploring; rebuild once the mode ends. */
	private rebuildDeferred = false;

	private rebuildDebounced = debounce(() => void this.refreshVault(), 2000, true);
	private rebuilding = false;
	private rebuildPending = false;
	private renamed = new Map<string, string>();
	private floatingLayout: FloatingLayout | null = null;
	private changesGeneration = 0;
	private rebuildGeneration = 0;
	private closing = false;
	private openGeneration = 0;
	private openEventCleanups: Array<() => void> = [];
	private reopenRequested = false;
	private reopenPromise: Promise<void> | null = null;
	private closeEpoch = 0;
	private workspaceStateRevision = 0;
	private pendingWorkspaceCamera: { camera: CameraState; revision: number } | null = null;
	private lastWorkspaceCamera: CameraState | null = null;
	private lastWorkspaceQuery = "";
	private pendingWorkspaceQueryUi = false;
	private restoringWorkspaceState = false;
	private workspaceSaveTimer: number | null = null;
	private workspaceSaveWindow: Window | null = null;

	private savePositionsDebounced = debounce(
		() => void this.savePositions(),
		POSITION_SAVE_DEBOUNCE_MS,
		true
	);

	constructor(leaf: WorkspaceLeaf, private readonly plugin: GraphInsightPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return GRAPH_INSIGHT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t("panel.title");
	}

	getIcon(): string {
		return "git-fork";
	}

	getState(): Record<string, unknown> {
		const camera = this.pendingWorkspaceCamera?.camera
			?? this.renderer?.getCameraState()
			?? this.lastWorkspaceCamera;
		const state: Record<string, unknown> = { version: 1, hardQuery: this.lastWorkspaceQuery };
		if (camera) state.camera = camera;
		return state;
	}

	async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		const normalized = normalizeGraphViewState(state);
		if (!normalized) return;
		const revision = ++this.workspaceStateRevision;
		if (normalized.camera) {
			this.lastWorkspaceCamera = normalized.camera;
			this.pendingWorkspaceCamera = { camera: normalized.camera, revision };
			this.applyPendingWorkspaceCamera();
		}
		if (normalized.hardQuery !== undefined) {
			await this.restoreWorkspaceQuery(normalized.hardQuery);
		}
	}

	private applyPendingWorkspaceCamera(): boolean {
		const pending = this.pendingWorkspaceCamera;
		if (!pending || this.closing || this.reopenRequested || !this.renderer || !this.model) return false;
		this.renderer.restoreCameraState(pending.camera);
		this.autoFit.cancel();
		this.lastWorkspaceCamera = pending.camera;
		if (this.pendingWorkspaceCamera?.revision === pending.revision) {
			this.pendingWorkspaceCamera = null;
		}
		return true;
	}

	private async restoreWorkspaceQuery(query: string): Promise<void> {
		const trimmed = query.trim();
		this.lastWorkspaceQuery = trimmed;
		this.softQuery = null;
		this.hardQuery = trimmed ? parseQuery(trimmed) : null;
		this.hardQueryText = trimmed;
		this.searchParseError = undefined;
		this.pendingWorkspaceQueryUi = true;
		this.syncWorkspaceQueryUi();
		this.recomputeVisual();
		if (this.model && this.hardQuery) {
			await this.ensureContentIndex(contentNeedles(this.hardQuery));
		}
	}

	private syncWorkspaceQueryUi(): void {
		if (!this.pendingWorkspaceQueryUi || this.reopenRequested || !this.searchBar || !this.model) return;
		this.restoringWorkspaceState = true;
		try {
			this.searchBar.applyQuery(this.hardQueryText);
			this.pendingWorkspaceQueryUi = false;
		} finally {
			this.restoringWorkspaceState = false;
		}
	}

	private commitSearchQuery(query: string): void {
		const trimmed = query.trim();
		this.searchParseError = undefined;
		// Any new commit is a view-state change: the task's undo expires.
		this.taskQueryUndo = null;
		if (trimmed) {
			const diagnostic = validateQuery(trimmed);
			if (diagnostic) {
				// A broken query never becomes the hard filter: the last valid one stays applied.
				this.searchParseError = diagnostic;
				this.pushSearchUi();
				return;
			}
		}
		this.hardQuery = trimmed ? parseQuery(trimmed) : null;
		this.hardQueryText = trimmed;
		this.lastWorkspaceQuery = trimmed;
		this.softQuery = null;
		this.recomputeVisual();
		if (!this.restoringWorkspaceState) this.scheduleWorkspaceSave();
		if (this.hardQuery && !this.restoringWorkspaceState) {
			void this.ensureContentIndex(contentNeedles(this.hardQuery));
		}
	}

	private clearSearchQuery(): void {
		this.softQuery = null;
		this.hardQuery = null;
		this.hardQueryText = "";
		this.lastWorkspaceQuery = "";
		this.searchParseError = undefined;
		this.taskQueryUndo = null;
		this.recomputeVisual();
		if (!this.restoringWorkspaceState) this.scheduleWorkspaceSave();
	}

	private handleCameraChanged(): void {
		this.autoFit.cancel();
		this.scheduleWorkspaceSave();
	}

	private scheduleWorkspaceSave(): void {
		if (this.restoringWorkspaceState) return;
		const ownerWindow = this.viewWindow;
		if (!ownerWindow) return;
		this.cancelWorkspaceSave();
		this.workspaceSaveWindow = ownerWindow;
		this.workspaceSaveTimer = ownerWindow.setTimeout(() => {
			this.workspaceSaveTimer = null;
			this.workspaceSaveWindow = null;
			void this.app.workspace.requestSaveLayout();
		}, WORKSPACE_SAVE_DEBOUNCE_MS);
	}

	private cancelWorkspaceSave(): void {
		if (this.workspaceSaveTimer !== null) {
			this.workspaceSaveWindow?.clearTimeout(this.workspaceSaveTimer);
		}
		this.workspaceSaveTimer = null;
		this.workspaceSaveWindow = null;
	}

	private captureWorkspaceStateForReopen(): void {
		const camera = this.renderer?.getCameraState();
		if (camera && this.pendingWorkspaceCamera === null) {
			this.lastWorkspaceCamera = camera;
			this.pendingWorkspaceCamera = { camera, revision: this.workspaceStateRevision };
		}
		this.lastWorkspaceQuery = this.hardQueryText;
		this.pendingWorkspaceQueryUi = true;
	}

	private nativePreviewPath(nodeId: number | null): string | null {
		const path = nodeId === null ? undefined : this.model?.nodes[nodeId]?.path;
		const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
		return file instanceof TFile ? file.path : null;
	}

	async onOpen(): Promise<void> {
		this.clearOpenListeners();
		const openGeneration = ++this.openGeneration;
		this.closing = false;
		if (this.pendingWorkspaceQueryUi) {
			this.hardQueryText = this.lastWorkspaceQuery;
			this.hardQuery = this.lastWorkspaceQuery ? parseQuery(this.lastWorkspaceQuery) : null;
			this.softQuery = null;
			this.searchParseError = undefined;
		}
		this.responsiveModeState = "full";
		const container = this.contentEl;
		const viewDocument = container.ownerDocument;
		const viewWindow = viewDocument.defaultView ?? (container as HTMLElement & { win?: Window }).win;
		if (!viewWindow) throw new Error("Graph host window is unavailable");
		this.viewDocument = viewDocument;
		this.viewWindow = viewWindow;
		this.registerWindowMigration(container);
		container.empty();
		container.setAttribute("data-graph-responsive", "full");
		container.addClass("graph-insight-container");

		const tooltip = container.createDiv({ cls: "graph-insight-tooltip" });
		tooltip.hide();
		this.tooltip = tooltip;

		const renderer = new GraphRenderer({
			onCameraChanged: () => this.handleCameraChanged(),
			onNodePreview: (nodeId, event) => {
				this.nativeHoverPreview?.hover(this.nativePreviewPath(nodeId), event);
			},
			onNodeHover: (nodeId, clientX, clientY) => {
				if (this.isExploring) this.showExploreTarget(nodeId, clientX, clientY);
				else this.showTooltip(nodeId, clientX, clientY);
			},
			onNodeClick: (nodeId, event) => this.handleNodeClick(nodeId, event),
			// F-02: a double-click enters Focus around the node and never opens
			// the note — the same under every cursor tool. Explore keeps its own
			// semantics: one transition, never two.
			onNodeDoubleClick: (nodeId) => {
				if (this.isExploring) {
					if (this.exploreDetached) {
						this.renderer?.setSelected(nodeId);
						void this.enterExplore(nodeId);
					}
					return;
				}
				this.renderer?.setSelected(nodeId);
				this.enterFocus(nodeId);
			},
			onNodeMiddleClick: (nodeId) => this.openNode(nodeId, true),
			onNodeContextMenu: (nodeId, event) => this.showNodeMenu(nodeId, event),
			onLassoSelect: (nodeIds, event) => this.showLassoMenu(nodeIds, event),
			onNodeDragStart: (nodeId) => this.layout?.dragStart(nodeId),
			onNodeDrag: (nodeId, x, y, z) => this.layout?.dragMove(nodeId, x, y, z),
			onNodeDragEnd: (nodeId) => {
				// Released node keeps its spot (temporary fixation) — otherwise
				// the warm simulation immediately drags it back to its links,
				// which feels like the node is glued in place. Context menu →
				// «Открепить» releases it.
				this.pinnedNodes.add(nodeId);
				this.layout?.dragEnd();
				this.savePositionsDebounced();
			},
			onExploreAim: (nodeId, clientX, clientY) => {
				this.exploreSession?.aimAt(nodeId);
				this.showExploreTarget(nodeId, clientX, clientY);
			},
			onExploreJump: () => this.exploreSession?.jump(),
			onContextLost: () => this.reportContextLost(),
		});
		this.renderer = renderer;
		try {
			await renderer.init(container, this.plugin.settings.renderScale);
		} catch (error) {
			renderer.destroy();
			if (this.renderer === renderer) this.renderer = null;
			if (this.tooltip === tooltip) this.tooltip = null;
			if (!this.closing && this.openGeneration === openGeneration) {
				console.error("Advanced Graph View: renderer startup failed", error);
				renderGraphStartupError(container, () => this.retryStartup(openGeneration));
			}
			return;
		}
		if (this.closing || this.openGeneration !== openGeneration || this.renderer !== renderer) {
			renderer.destroy();
			if (this.renderer === renderer) this.renderer = null;
			return;
		}

		this.nativeHoverPreview?.destroy();
		this.nativeHoverPreview = renderer.canvasElement ? new NativeHoverPreview(
			renderer.canvasElement, GRAPH_INSIGHT_VIEW_TYPE,
			(name, payload) => this.app.workspace.trigger(name, payload),
			(x, y) => this.nativePreviewPath(renderer.previewNodeAt(x, y)),
		) : null;

		this.stopObservingRendererVisibility?.();
		this.stopObservingRendererVisibility = observeRendererVisibility(container, renderer, () => this.nativeHoverPreview?.clear());

		// Any manual pan/zoom/drag means the user framed the view themselves.
		const cancelAutoFit = () => this.autoFit.cancel();
		container.addEventListener("pointerdown", cancelAutoFit);
		container.addEventListener("wheel", cancelAutoFit);
		this.openEventCleanups.push(() => {
			container.removeEventListener("pointerdown", cancelAutoFit);
			container.removeEventListener("wheel", cancelAutoFit);
		});
		// The pane may not have its final size during onOpen; resize once the
		// layout settles so the canvas fills the whole view.
		this.resizeFrame = viewWindow.requestAnimationFrame(() => {
			if (this.openGeneration === openGeneration) this.resizeFrame = null;
			if (!this.closing && this.openGeneration === openGeneration && this.renderer === renderer) {
				renderer.resize();
			}
		});

		this.layout = new LayoutClient(
			(positions) => this.receiveLayoutPositions(positions),
			(positions) => {
				this.receiveLayoutPositions(positions);
				this.savePositionsDebounced();
				this.redrawBubbles();
				if (shouldFitOnSettle(this.autoFit, this.plugin.settings.panel.view3d.enabled)) {
					this.renderer?.fitAll();
				}
			},
			() => this.reportWorkerFailure("layout")
		);

		this.metricsClient = new MetricsClient(
			(metrics) => this.handleMetricsResult(metrics),
			() => this.reportWorkerFailure("metrics")
		);

		this.panel = this.buildPanel(this.plugin.settings.panel);
		this.panel.setViewPresets(this.presetRows(this.plugin.settings.viewPresets));
		this.legend = new Legend(container);
		this.cameraWidget = new CameraWidget(
			container,
			this.plugin.settings.panel.view3d,
			this.plugin.settings.panel.physics.freeLayout,
			{
				onToggle3D: (enabled) => void this.updatePanelState((state) => ({
					...state,
					view3d: { ...state.view3d, enabled },
				})),
				onToggleFreeLayout: (enabled) => void this.updatePanelState((state) => ({
					...state,
					physics: { ...state.physics, freeLayout: enabled },
				})),
				onFit: () => this.renderer?.fitAll(),
				onReset: () => this.renderer?.resetCamera(),
				onToggleUI: (hidden) => this.contentEl.toggleClass("graph-insight-ui-hidden", hidden),
				onToggleExplore: () => void (this.exploreSession ? this.exitExplore() : this.enterExplore()),
			}
		);

		// One flexible top row for the toolbar, the search bar and the
		// focus/explore bar: flow layout instead of absolute positioning, so
		// the blocks wrap under each other instead of overlapping (F-04).
		const topBar = container.createDiv({ cls: "graph-insight-topbar" });

		this.searchBar = new SearchBar(topBar, {
			onQueryChange: (query) => {
				this.softQuery = query.trim() ? parseQuery(query) : null;
				this.searchParseError = undefined;
				this.scheduleVisualRecompute();
			},
			onCommit: (query) => this.commitSearchQuery(query),
			onClear: () => this.clearSearchQuery(),
			onSavePreset: (query) => this.savePreset(query),
			onPresetApplied: (id) => void this.markPresetUsed(id),
				onManagePresets: () => this.openPresetManager(),
				onTasksMenu: (anchor) => this.showTasksMenu(anchor),
				onConstraintRemove: (id) => this.removeConstraint(id),
				onResetConstraints: () => void this.resetViewState(),
			});
		this.searchBar.setPresets(sortSearchPresets(this.plugin.settings.presets));
		this.filterChips = new FilterChips(this.searchBar.filtersHost, {
			onChange: (selection) => {
				this.chipFilter = selection;
				this.recomputeVisual();
				void this.plugin.saveChipFilter({
					tags: [...selection.tags],
					folders: [...selection.folders],
				});
			},
		});
		// Restore the last session's filter so the graph opens where it left off.
		const savedFilter = this.plugin.settings.chipFilter;
		if (savedFilter.tags.length > 0 || savedFilter.folders.length > 0) {
			this.chipFilter = { tags: new Set(savedFilter.tags), folders: new Set(savedFilter.folders) };
			this.filterChips.setSelection(this.chipFilter);
		}

		this.toolBar = new ToolBar(
			container,
			this.cursorTool,
			this.focusDepth,
			this.plugin.settings.followActiveNote,
			this.plugin.settings.openInSidePane,
			{
				onToolChange: (tool) => {
					this.cursorTool = tool;
					this.pathAnchor = null;
					// A drawn route belongs to the path tool; leaving it behind
					// would mark links the current tool knows nothing about.
					if (tool !== "path") {
						this.renderer?.setPathHighlight(null);
						this.pathDrawn = false;
					}
					if (tool !== "links" && this.focusRootId !== null) this.exitFocus();
				},
				onDepthChange: (depth) => {
					this.focusDepth = depth;
					if (this.focusRootId !== null) {
						this.renderFocusBar();
						this.recomputeVisual();
					}
				},
				onToggleFollow: (enabled) => void this.plugin.setFollowActiveNote(enabled),
				onToggleSidePane: (enabled) => void this.plugin.setOpenInSidePane(enabled),
				onOpenLocalGraph: () => void this.plugin.activateLocalGraph(),
				onOverflowMenu: (anchor) => this.showOverflowMenu(anchor),
			}
		);

		this.focusBar = topBar.createDiv({ cls: "graph-insight-focusbar" });
		this.focusBar.hide();

		this.timeline = new TimelineBar(container, {
			onCutoffChange: (cutoff) => {
				this.timelineCutoff = cutoff;
				this.recomputeVisual();
			},
			onModeChange: (mode) => {
				this.timelineMode = mode;
				this.refreshTimelineData();
			},
		});
		this.floatingLayout = new FloatingLayout(container, (width) => this.applyResponsiveMode(responsiveMode(width)));

		// Capture phase, and the explore keys are swallowed outright.
		// `preventDefault` alone is not enough: Obsidian's own key handling is
		// registered on the document before any plugin's, so a bubbling
		// listener runs *after* the app has already acted on Esc — which is
		// why Esc used to look like it closed the whole view.
		const onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
		viewDocument.addEventListener("keydown", onKeyDown, { capture: true });
		this.openEventCleanups.push(() => viewDocument.removeEventListener("keydown", onKeyDown, { capture: true }));

		await this.rebuildGraph();
		if (this.closing || this.openGeneration !== openGeneration) return;

		if (this.model) {
			this.registerOpenEvent(this.app.vault, this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) recordRename(this.renamed, oldPath, file.path);
			}));
		}
		this.registerOpenEvent(this.app.metadataCache, this.app.metadataCache.on("resolved", () => this.handleMetadataResolved()));
		this.registerOpenEvent(
			this.app.workspace,
			this.app.workspace.on("file-open", (file) => this.handleActiveNoteChanged(file))
		);
		// Theme switch or a newly installed theme: node, edge and label colors
		// all come from CSS variables, and the scheme itself is dimmed on light
		// themes — both have to be re-read, not just repainted.
		this.registerOpenEvent(this.app.workspace, this.app.workspace.on("css-change", () => this.handleThemeChange()));

		if (this.plugin.settings.onboardingState === "never-seen") {
			this.plugin.showOnboarding();
		}
	}

	/** A settings reload calls onClose without unloading the ItemView itself. */
	private registerOpenEvent(source: Pick<Events, "offref">, eventRef: EventRef): void {
		this.openEventCleanups.push(() => source.offref(eventRef));
	}

	private clearOpenListeners(): void {
		for (const cleanup of this.openEventCleanups.splice(0)) cleanup();
	}

	private registerWindowMigration(fallback: HTMLElement): void {
		const host = (this.containerEl as HTMLElement | undefined) ?? fallback;
		const subscribe = (host as unknown as {
			onWindowMigrated?: (listener: (win: Window) => void) => () => void;
		}).onWindowMigrated;
		if (typeof subscribe !== "function") return;
		const stop = subscribe.call(host, () => {
			// Detach from the old document and window before persistence can await.
			this.clearOpenListeners();
			void this.reopen().catch((error) => {
				console.error("Advanced Graph View: window migration reload failed", error);
			});
		});
		this.openEventCleanups.push(stop);
	}

	private handleKeyDown(event: KeyboardEvent): void {
		if (this.exploreNoteModal) return;
		if (!this.contentEl.isShown()) return;
		if (this.app.workspace.getActiveViewOfType(GraphInsightView) !== this) return;
		const target = event.target as HTMLElement | null;
		// Don't hijack keys while the user is editing the search box etc.
		if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
			return;
		}

		/** Take the key away from Obsidian entirely. */
		const claim = () => {
			event.preventDefault();
			event.stopImmediatePropagation();
		};

		if (this.isExploring) {
			switch (event.key) {
				case "Escape":
					claim();
					void this.exitExplore();
					return;
				case "Backspace":
					claim();
					this.exploreBack();
					return;
				case " ":
					// Space = let go: stay in the mode, pick the next note
					// anywhere. It has to be its own key — Esc leaving the mode
					// is the one thing that must never be ambiguous.
					claim();
					this.detachExplore();
					return;
			}
			return;
		}

		if (event.key !== "Escape") return;
		if (this.focusRootId !== null) {
			this.exitFocus();
		} else if (this.hasActiveViewState()) {
				void this.resetViewState();
		}
	}

	/** «Путь»: first click sets the anchor, second highlights the chain. */
	private handlePathPick(nodeId: number): void {
		if (!this.model) return;
		if (this.pathAnchor === null || this.pathAnchor === nodeId) {
			this.pathAnchor = nodeId;
			this.toolBar?.setPathStage("end");
			new Notice(t("notice.pathStart", { name: this.model.nodes[nodeId].name }));
			return;
		}
		const path = shortestPath(
			this.graphAdjacency(),
			this.model.nodes.length,
			this.pathAnchor,
			nodeId
		);
		this.pathAnchor = null;
		this.toolBar?.setPathStage("start");
		if (path.length === 0) {
			new Notice(t("notice.pathNone"));
			this.renderer?.setAlphaFactors(null);
			this.renderer?.setHighlightMask(null);
			this.renderer?.setPathHighlight(null);
			this.pathDrawn = false;
			return;
		}
		const onPath = new Set(path);
		const factors = new Float32Array(this.model.nodes.length).fill(0.06);
		const highlight = new Uint8Array(this.model.nodes.length);
		for (const id of onPath) {
			factors[id] = 1;
			highlight[id] = 1;
		}
		this.renderer?.setAlphaFactors(factors);
		this.renderer?.setHighlightMask(highlight);
		// The links along the route, not just its notes: on a dense graph two
		// lit nodes do not say which way the chain actually runs.
		this.renderer?.setPathHighlight(path);
		this.pathDrawn = true;
		this.renderer?.zoomToNodes(path);
		const names = path.map((id) => this.model!.nodes[id].name);
		new Notice(t("notice.pathFound", { count: path.length, names: names.join(" → ") }), 8000);
	}

	// ── Focus mode ────────────────────────────────────────────────────

	/** F-11: session-only histories behind the breadcrumbs; never persisted. */
	private focusTrail: NavigationTrail | null = null;
	private exploreTrail: NavigationTrail | null = null;

	private enterFocus(nodeId: number, fromTrail = false): void {
		this.focusRootId = nodeId;
		if (!fromTrail && this.model) {
			this.focusTrail ??= new NavigationTrail("focus");
			const node = this.model.nodes[nodeId];
			this.focusTrail.push({ path: node.path, label: node.name });
		}
		this.renderFocusBar();
		this.recomputeVisual();
	}

	private exitFocus(): void {
		this.focusRootId = null;
		this.focusTrail = null;
		this.focusBar?.hide();
		this.recomputeVisual();
	}

	/** Shared by both bars: crumbs render into `host`, clicks land in `go`. */
	private renderTrail(host: HTMLElement, trail: NavigationTrail, go: (nodeId: number) => void): void {
		const strip = host.createDiv({ cls: "graph-insight-breadcrumb" });
		renderBreadcrumb(
			strip,
			trail,
			(path) => this.model?.pathToId.get(path) === undefined,
			this.responsiveModeState !== "full",
			{
				onCrumb: (index) => {
					const target = trail.items[index];
					const id = target ? this.model?.pathToId.get(target.path) : undefined;
					// Rejected Explore destinations must not move the history cursor.
					if (trail === this.exploreTrail && (id === undefined || this.hiddenMask?.[id] === 1)) return;
					trail.jumpTo(index);
					if (id !== undefined) go(id);
				},
				onRemove: (index) => {
					trail.removeAt(index);
					if (trail === this.focusTrail) this.renderFocusBar();
					else this.renderExploreBar();
				},
			}
		);
	}

	// ── F-10: what changed ────────────────────────────────────────────

	private changesPanel: ChangesPanel | null = null;
	private changesClient: ChangesClient | null = null;
	/** Runtime only: never part of a view preset, never persisted (§6.2). */
	private changesSelection: { periodDays: 7 | 30; category: ChangeCategory | null } = {
		periodDays: 7,
		category: null,
	};
	private changesData: ChangesData | null = null;
	/** Node ids the selected category highlights, folded into recomputeVisual. */
	private changesHighlight: Set<number> | null = null;

	/** Command + overflow menu entry. Closing keeps the selected category —
	 *  only "Reset changes" clears it (§F-10). */
	toggleChangesPanel(): void {
		return this.changesActions.toggleChangesPanel();
	}

	private ensureChangesPanel(): void {
		return this.changesActions.ensureChangesPanel();
	}

	private refreshChanges(): Promise<void> {
		return this.changesActions.refreshChanges();
	}

	private selectChangesCategory(category: ChangeCategory | null): void {
		return this.changesActions.selectChangesCategory(category);
	}

	/** Fold the selected category into a highlight set; recomputeVisual owns
	 *  the masks, so no rebuild and no extra pass (§F-10). */
	private applyChangesMask(): void {
		return this.changesActions.applyChangesMask();
	}

	/** A link row focuses both ends and lights the edge up, like the path tool. */
	private focusChangesLink(link: LinkChange): void {
		return this.changesActions.focusChangesLink(link);
	}

	canExportTopicMap(): boolean { return this.exportActions.canExportTopicMap(); }

	exportCurrentTopicMap(): void { this.exportActions.exportCurrentTopicMap(); }

	private openTopicMapExport(source: TopicMapSource, rootId: number | null, flatIds: number[] = []): void {
		this.exportActions.openTopicMapExport(source, rootId, flatIds);
	}

	/** Previous reachable crumb; filters must not desynchronise the camera and trail. */
	private previousExploreIndex(): number | null {
		if (!this.exploreTrail || !this.model) return null;
		for (let index = this.exploreTrail.activeIndex - 1; index >= 0; index--) {
			const id = this.model.pathToId.get(this.exploreTrail.items[index].path);
			if (id !== undefined && this.hiddenMask?.[id] !== 1) return index;
		}
		return null;
	}

	/** Backspace and the Back button both walk the same trail model (F-11). */
	private exploreBack(): void {
		const index = this.previousExploreIndex();
		if (index === null) return;
		const target = this.exploreTrail!.jumpTo(index)!;
		const id = this.model!.pathToId.get(target.path)!;
		this.navigateExploreTo(id);
		this.renderExploreBar();
	}

	get isFocused(): boolean {
		return this.focusRootId !== null;
	}

	// ── Follow active note ────────────────────────────────────────────

	/**
	 * The active note changed somewhere in the vault. What the graph does about
	 * it — if anything — is decided by resolveFollowAction; this only gathers
	 * the state that decision needs and carries out the verdict.
	 */
	private handleActiveNoteChanged(file: TFile | null): void {
		// One shot: whichever event this flag was set for is the one it answers.
		const openedByGraph = file !== null && file.path === this.selfOpenedPath;
		this.selfOpenedPath = null;
		if (!file || !this.model) return;

		const id = this.model.pathToId.get(file.path);
		const action = resolveFollowAction({
			enabled: this.plugin.settings.followActiveNote,
			graphVisible: this.containerEl.isShown(),
			exploring: this.isExploring,
			focused: this.isFocused,
			openedByGraph,
			inGraph: id !== undefined,
			filteredOut: id !== undefined && this.hiddenMask?.[id] === 1,
		});
		if (id === undefined || action === "ignore") return;
		if (action === "refocus") {
			this.enterFocus(id);
			return;
		}
		// Selection outlives the pan on purpose: it marks where you are, which
		// is the whole point of following.
		this.renderer?.setSelected(id);
		this.renderer?.centerOnNode(id);
	}

	setFollowActiveNote(enabled: boolean): void {
		void this.plugin.setFollowActiveNote(enabled);
		this.toolBar?.setFollowing(enabled);
	}

	setOpenInSidePane(enabled: boolean): void {
		void this.plugin.setOpenInSidePane(enabled);
		this.toolBar?.setSidePane(enabled);
	}

	// ── Pins ──────────────────────────────────────────────────────────

	/** Explicit pins and the temporary ones a drag leaves behind both count:
	 *  either way the node is holding still and the action is to release it. */
	private isPinned(nodeId: number): boolean {
		return this.explicitPins.has(nodeId) || this.pinnedNodes.has(nodeId);
	}

	/** Pin a node where it currently sits, or release it. Returns the state it
	 *  ended up in, so callers can word their own feedback. */
	private togglePin(nodeId: number): boolean {
		if (this.isPinned(nodeId)) {
			this.pinnedNodes.delete(nodeId);
			this.explicitPins.delete(nodeId);
			this.layout?.unpin(nodeId);
			this.afterPinChange();
			return false;
		}
		const positions = this.renderer?.currentPositions;
		if (!positions) return false;
		this.explicitPins.add(nodeId);
		this.layout?.pin(
			nodeId,
			positions[nodeId * 3], positions[nodeId * 3 + 1], positions[nodeId * 3 + 2]
		);
		this.afterPinChange();
		return true;
	}

	private setSelectionPinned(nodeIds: readonly number[], pinned: boolean): void {
		const positions = this.renderer?.currentPositions;
		if (!positions) return;
		for (const id of nodeIds) {
			if (pinned) {
				this.explicitPins.add(id);
				this.layout?.pin(id, positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]);
			} else {
				this.explicitPins.delete(id);
				this.pinnedNodes.delete(id);
				this.layout?.unpin(id);
			}
		}
		this.afterPinChange();
	}

	/** Drag pins stay out of the rings: every dragged node becomes one, and a
	 *  graph full of rings says nothing. Only deliberate pins are marked. */
	private afterPinChange(): void {
		this.renderer?.setPinned(new Set(this.explicitPins));
		this.savePositionsDebounced();
	}

	/** Leave focus mode from outside the view — the command palette. */
	leaveFocus(): void {
		if (this.focusRootId !== null) this.exitFocus();
	}

	private renderFocusBar(): void {
		if (!this.focusBar || !this.model || this.focusRootId === null) return;
		const distances = this.currentFocusDistances();
		const visible = distances ? distances.filter((d) => d >= 0).length : 0;
		this.focusBar.empty();
		this.focusBar.show();
		this.focusBar.createSpan({
			text: t("focus.status", {
				name: this.model.nodes[this.focusRootId].name,
				depth: this.focusDepth,
				count: visible,
			}),
		});
		const slider = this.focusBar.createEl("input", { type: "range" });
		slider.min = "1";
		slider.max = "4";
		slider.value = String(this.focusDepth);
		slider.addEventListener("input", () => {
			this.focusDepth = Number(slider.value);
			this.renderFocusBar();
			this.recomputeVisual();
		});
		const exportButton = this.focusBar.createEl("button", { text: t("topicmap.modalTitle") });
		exportButton.setAttribute("aria-label", t("topicmap.export"));
		exportButton.addEventListener("click", () => {
			if (this.focusRootId !== null) this.openTopicMapExport("focus", this.focusRootId);
		});
		const exit = this.focusBar.createEl("button", { text: t("focus.exit") });
		exit.addEventListener("click", () => this.exitFocus());
		if (this.focusTrail && this.focusTrail.items.length > 1) {
			this.renderTrail(this.focusBar, this.focusTrail, (id) => this.enterFocus(id, true));
		}
	}

	// ── Explore mode ──────────────────────────────────────────────────

	/**
	 * Hop the camera from node to node down the links, No Man's Sky style.
	 *
	 * Two settings are forced for the duration and restored on exit: 3D,
	 * because hopping a flat picture has nothing to hop through, and physics,
	 * because a node that drifts while the camera flies towards it means the
	 * camera lands next to it instead of on it.
	 */
	enterExplore(startId?: number): Promise<void> {
		return this.exploreBindings.enterExplore(startId);
	}

	/**
	 * Let go of the current node without leaving the mode: the graph lights
	 * back up and the pointer picks nodes again, so the next leg of the trip
	 * can start anywhere instead of only where the links reach.
	 */
	private detachExplore(): void {
		return this.exploreBindings.detachExplore();
	}

	/**
	 * Force 3D on and physics off for the duration — on the renderer and the
	 * layout worker only.
	 *
	 * Deliberately NOT through `updatePanelState`: that writes to the saved
	 * settings, and a crash or a plugin reload mid-session then leaves the
	 * vault permanently frozen with the simulation switched off and nothing to
	 * explain it. Mode state does not belong in user settings.
	 */
	private applyExploreOverride(): void {
		return this.exploreBindings.applyExploreOverride();
	}

	exitExplore(): Promise<void> {
		return this.exploreBindings.exitExplore();
	}

	/** Name the note a link leads to, right at the pointer. */
	private showExploreTarget(nodeId: number | null, clientX: number, clientY: number): void {
		return this.exploreBindings.showExploreTarget(nodeId, clientX, clientY);
	}

	/** True for the whole mode, anchored to a node or not. */
	get isExploring(): boolean {
		return this.exploreSession !== null || this.exploreDetached;
	}

	/** All explicit Explore choices use the same flight and route. */
	private navigateExploreTo(nodeId: number): void {
		return this.exploreBindings.navigateExploreTo(nodeId);
	}

	private openExploreNotePicker(): void {
		return this.exploreBindings.openExploreNotePicker();
	}

	/** Reuses the focus bar for anchored and detached navigation. */
	private renderExploreBar(): void {
		return this.exploreBindings.renderExploreBar();
	}

	private currentFocusDistances(): Int16Array | null {
		if (!this.model || this.focusRootId === null) return null;
		const cached = this.focusDistanceCache;
		if (cached?.model === this.model && cached.rootId === this.focusRootId && cached.depth === this.focusDepth) {
			return cached.value;
		}
		const value = computeDistances(this.graphAdjacency(), this.model.nodes.length, this.focusRootId, this.focusDepth);
		this.focusDistanceCache = { model: this.model, rootId: this.focusRootId, depth: this.focusDepth, value };
		return value;
	}

	private graphAdjacency(): Adjacency {
		if (!this.model) return [];
		if (this.adjacencyCache?.model === this.model) return this.adjacencyCache.value;
		const value = buildAdjacency(this.model);
		this.adjacencyCache = { model: this.model, value };
		this.focusDistanceCache = null;
		return value;
	}

	// ── Visual state composition ──────────────────────────────────────

	/** One place that folds search/focus/hidden sets into renderer masks. */
	private recomputeVisual(): void {
		if (this.visualFrame !== null) {
			this.viewWindow?.cancelAnimationFrame(this.visualFrame);
			this.visualFrame = null;
		}
		if (!this.renderer || !this.model) return;
		const count = this.model.nodes.length;
		const now = Date.now();

		const contentMatcher = (needle: string, path: string) =>
			this.contentIndex.get(needle)?.has(path) ?? true;

		// One scratch mask, handed to the renderer only when something is
		// actually hidden — and counted below without a second query pass.
		const hiddenScratch = new Uint8Array(count);
		let hiddenCount = 0;
		const hide = (i: number) => {
			if (hiddenScratch[i] === 0) {
				hiddenScratch[i] = 1;
				hiddenCount++;
			}
		};
		if (this.hardQuery) {
			for (let i = 0; i < count; i++) {
				if (!matchesQuery(this.hardQuery, this.facts[i], now, contentMatcher)) hide(i);
			}
		}
		// Tag/folder dropdowns: OR within a list, AND between the two lists.
		const { tags: pickedTags, folders: pickedFolders } = this.chipFilter;
		if (pickedTags.size > 0 || pickedFolders.size > 0) {
			const chipMatcher = compileChipFilter(pickedTags, pickedFolders);
			for (let i = 0; i < count; i++) {
				const facts = this.facts[i];
				if (!chipMatcher.matches(facts)) hide(i);
			}
		}
		if (this.hiddenClusters.size > 0 && this.metrics) {
			for (let i = 0; i < count; i++) {
				if (this.hiddenClusters.has(this.metrics.community[i])) hide(i);
			}
		}
		if (this.timelineCutoff !== null) {
			for (let i = 0; i < count; i++) {
				const ts = this.timelineMode === "created" ? this.facts[i].ctime : this.facts[i].mtime;
				if (ts >= this.timelineCutoff) hide(i);
			}
		}
		for (const id of this.hiddenNodes) hide(id);
		const hidden = hiddenCount > 0 ? hiddenScratch : null;
		this.hiddenMask = hidden;
		this.renderer.setHiddenMask(hidden);

		let factors: Float32Array | null = null;
		let highlight: Uint8Array | null = null;
		let softMatched = 0;
		if (this.softQuery) {
			factors = new Float32Array(count);
			highlight = new Uint8Array(count);
			for (let i = 0; i < count; i++) {
				const matched = matchesQuery(this.softQuery, this.facts[i], now, contentMatcher);
				factors[i] = matched ? 1 : 0.12;
				if (matched) {
					highlight[i] = 1;
					if (!hidden || hidden[i] !== 1) softMatched++;
				}
			}
		}
		// Filter chips narrow the graph — brighten the survivors with the
		// accent tint + size boost so the matching notes read at a glance
		// instead of sitting at their normal weight.
		if ((pickedTags.size > 0 || pickedFolders.size > 0) && hidden) {
			highlight ??= new Uint8Array(count);
			for (let i = 0; i < count; i++) {
				if (hidden[i] !== 1) highlight[i] = 1;
			}
		}
		// Active overlays glow with the accent color, same as search hits.
		if (this.overlayMask) {
			highlight ??= new Uint8Array(count);
			for (let i = 0; i < count; i++) {
				if (this.overlayMask[i] === 1) highlight[i] = 1;
			}
		}
		// F-10: the selected changes category glows the same way.
		if (this.changesHighlight && this.changesHighlight.size > 0) {
			highlight ??= new Uint8Array(count);
			for (const id of this.changesHighlight) {
				if (id < count) highlight[id] = 1;
			}
		}
		const distances = this.currentFocusDistances();
		if (distances) {
			factors ??= new Float32Array(count).fill(1);
			// Everything the slider reaches is accented, the same way the path
			// tool marks its chain; distance only sets how bright.
			highlight ??= new Uint8Array(count);
			for (let i = 0; i < count; i++) {
				const d = distances[i];
				factors[i] *= focusFalloff(d, this.focusDepth);
				if (d >= 0) highlight[i] = 1;
			}
		}
		this.renderer.setHighlightMask(highlight);
		// Explore mode leaves only the node you are on and the ones you can
		// travel to readable — everything else is the sky you fly through.
		if (this.exploreFocus) {
			factors ??= new Float32Array(count).fill(1);
			const reachable = new Set(this.exploreFocus.neighbors);
			highlight ??= new Uint8Array(count);
			for (let i = 0; i < count; i++) {
				const isHere = i === this.exploreFocus.centerId;
				factors[i] *= isHere || reachable.has(i) ? 1 : EXPLORE_BACKGROUND_ALPHA;
				if (isHere) highlight[i] = 1;
			}
			this.renderer.setHighlightMask(highlight);
		}
		this.renderer.setAlphaFactors(factors);

		// The counters come from the exact masks just applied — never a
		// second query pass (§9: one pass per frame on 50k nodes).
		this.searchCounts = { softMatched, visible: count - hiddenCount, total: count };
		this.pushSearchUi();
		this.updateFilteredEmptyState(count - hiddenCount, this.activeConstraints().length > 0 || this.hardQuery !== null);
	}

	private scheduleVisualRecompute(): void {
		if (this.visualFrame !== null) return;
		const viewWindow = this.viewWindow;
		if (!viewWindow) return;
		const generation = this.openGeneration;
		this.visualFrame = viewWindow.requestAnimationFrame(() => {
			if (generation !== this.openGeneration) return;
			this.visualFrame = null;
			this.recomputeVisual();
		});
	}

	/** Report mode, counts and errors to the search bar. */
	private pushSearchUi(): void {
		const mode: SearchMode = this.softQuery ? "highlight" : this.hardQuery ? "filter" : "idle";
		this.searchBar?.setUiState({
			mode,
			query: this.hardQueryText,
			matchedCount: mode === "highlight" ? this.searchCounts.softMatched : this.searchCounts.visible,
			visibleCount: this.searchCounts.visible,
			totalCount: this.searchCounts.total,
			isIndexingContent: this.contentIndexJobs > 0,
			parseError: this.searchParseError,
			constraints: this.activeConstraints(),
		});
	}

	private activeConstraints(): SearchConstraint[] {
		const constraints: SearchConstraint[] = [];
		for (const tag of this.chipFilter.tags) {
			constraints.push({ id: `tag:${encodeURIComponent(tag)}`, label: `#${tag}` });
		}
		for (const folder of this.chipFilter.folders) {
			constraints.push({ id: `folder:${encodeURIComponent(folder)}`, label: folder });
		}
		for (const cluster of this.hiddenClusters) {
			constraints.push({
				id: `cluster:${cluster}`,
				label: `${t("panel.section.clusters")}: ${this.clusterNames[cluster] ?? `#${cluster}`}`,
			});
		}
		if (this.hiddenNodes.size > 0) {
			constraints.push({ id: "hidden-nodes", label: `${t("layers.hidden")} · ${this.hiddenNodes.size}` });
		}
		if (this.timelineCutoff !== null) constraints.push({ id: "timeline", label: t("layers.timeline") });
		return constraints;
	}

	private removeConstraint(id: string): void {
		if (id.startsWith("tag:")) this.chipFilter.tags.delete(decodeURIComponent(id.slice(4)));
		else if (id.startsWith("folder:")) this.chipFilter.folders.delete(decodeURIComponent(id.slice(7)));
		else if (id.startsWith("cluster:")) this.hiddenClusters.delete(Number(id.slice(8)));
		else if (id === "hidden-nodes") this.hiddenNodes.clear();
		else if (id === "timeline") {
			this.timelineCutoff = null;
			this.timeline?.resetCutoff();
		}
		this.filterChips?.setSelection(this.chipFilter);
		this.panel?.setHiddenNodeCount(this.hiddenNodes.size);
		void this.plugin.saveChipFilter({ tags: [...this.chipFilter.tags], folders: [...this.chipFilter.folders] });
		this.recomputeVisual();
	}

	/** Scan note bodies for content-search needles not yet indexed. */
	private async ensureContentIndex(needles: string[]): Promise<void> {
		const missing = needles.filter((n) => !this.contentIndex.has(n));
		if (missing.length === 0) return;
		const files = this.app.vault.getMarkdownFiles();
		const generation = this.contentIndexGeneration;
		for (const needle of missing) this.contentIndex.set(needle, new Set());
		// While the scan runs the bar says "Indexing…" instead of a count that
		// would wrongly read as the final (often zero) result.
		this.contentIndexJobs++;
		this.filteredEmptyState?.remove();
		this.filteredEmptyState = null;
		this.pushSearchUi();
		try {
			for (const file of files) {
				if (generation !== this.contentIndexGeneration) return;
				let text: string;
				try {
					text = (await this.app.vault.cachedRead(file)).toLowerCase();
				} catch {
					continue;
				}
				if (generation !== this.contentIndexGeneration) return;
				for (const needle of missing) {
					if (text.includes(needle)) this.contentIndex.get(needle)!.add(file.path);
				}
			}
		} finally {
			this.contentIndexJobs--;
			// Even a cancelled scan must clear its contribution to "Indexing".
			this.recomputeVisual();
		}
	}

	// ── Menus ─────────────────────────────────────────────────────────

	private showNodeMenu(nodeId: number, event: MouseEvent): void {
		this.menus.showNodeMenu(nodeId, event);
	}

	private showLassoMenu(nodeIds: number[], event: PointerEvent): void {
		this.menus.showLassoMenu(nodeIds, event);
	}

	private openNode(nodeId: number, newTab: boolean): void {
		this.noteNavigation.openNode(nodeId, newTab);
	}

	/** Open beside the graph, reusing the pane from the previous note. */
	private openNodeInSplit(nodeId: number): void {
		this.noteNavigation.openNodeInSplit(nodeId);
	}

	/** Show the note in the file explorer's tree, the way the core graph does. */
	private revealNode(nodeId: number): void {
		this.noteNavigation.revealNode(nodeId);
	}

	/** The core file explorer, if it is loaded and still exposes revealInFolder. */
	private fileExplorer(): { leaf: WorkspaceLeaf; view: FileExplorerView } | null {
		return this.noteNavigation.fileExplorer();
	}

	/** Panel rows carry the translated name; the stored preset keeps its own. */
	private presetRows(presets: readonly ViewPreset[]): { name: string }[] {
		return presets.map((preset) => ({ name: presetDisplayName(preset) }));
	}

	/** F-09: explicit naming instead of the old first-24-characters auto-name. */
	private savePreset(query: string): void {
		this.presetActions.savePreset(query);
	}

	/** Applying a preset moves it to the top of the recently-used order. */
	private async markPresetUsed(id: string): Promise<void> {
		await this.presetActions.markPresetUsed(id);
	}

	private openPresetManager(): void {
		this.presetActions.openPresetManager();
	}

	private handleMetadataResolved(): void {
		this.contentIndex.clear();
		this.contentIndexGeneration++;
		this.rebuildDebounced();
	}

	/** Content edits also need a rescan when link topology stays unchanged. */
	private async refreshVault(): Promise<void> {
		await this.rebuildGraph();
		if (this.hardQuery) await this.ensureContentIndex(contentNeedles(this.hardQuery));
	}

	private async rebuildGraph(): Promise<void> {
		if (this.closing || !this.renderer || !this.layout) return;
		// A rebuild renumbers nodes, and explore mode holds node ids: an
		// adjacency list from the old model would fly the camera to whatever
		// note inherited the number. Hold the rebuild until the mode ends.
		if (this.exploreSession) {
			this.rebuildDeferred = true;
			return;
		}
		const files = this.app.vault.getMarkdownFiles();
		const cache = this.app.metadataCache;
		const model = buildGraphModel(files.map((f) => f.path), cache.resolvedLinks, cache.unresolvedLinks);

		if (this.rebuilding) {
			this.rebuildPending = true;
			return;
		}
		if (this.model && sameGraphModel(this.model, model)) {
			this.refreshFacts(files);
			return;
		}
		this.rebuilding = true;

		const generation = ++this.rebuildGeneration;
		try {
			const renamed = new Map(this.renamed);
			const { seed, pinnedPaths } = await this.buildSeedPositions(model, renamed);
			if (generation !== this.rebuildGeneration || this.closing) return;
			// Frame the graph once the very first layout settles; later rebuilds
			// (vault edits) keep whatever framing the user has.
			if (!this.model && this.pendingWorkspaceCamera === null) this.autoFit.request();
			this.nativeHoverPreview?.clear();
			this.model = model;
			consumeRenames(this.renamed, renamed);
			this.facts = this.buildFacts(model, files);
			this.panel?.setPropertyKeys(collectPropertyKeys(this.facts, this.plugin.settings.panel.channels.color));
			this.metrics = null;
			this.hasLayoutPositions = false;
			this.renderer.setModel(model);
			const view3d = this.plugin.settings.panel.view3d;
			const dims = view3d.enabled && view3d.depthSource === "physics" ? 3 : 2;
			this.layout.start(model, seed, dims);
			this.restorePins(model, seed, pinnedPaths);
			this.apply3D(this.plugin.settings.panel, false);
			this.applyPendingWorkspaceCamera();
			this.lastPhysics = "";
			this.applyPhysics(this.plugin.settings.panel);
			// The fresh worker knows nothing about the saved grouping rule, and the
			// node ids behind this.facts have just changed - recompute from scratch.
			this.appliedLayoutRule = null;
			this.applyLayoutRule(this.plugin.settings.panel.layoutRule);
			// F-10: node ids just changed - the old highlight indices are garbage.
			// The data itself is path-based; recompute it if the panel is open.
			this.changesGeneration++;
			this.changesClient?.stop();
			this.changesHighlight = null;
			this.changesData = null;
			if (this.changesPanel?.isShown) void this.refreshChanges();
			const panelState = this.plugin.settings.panel;
			this.renderer.setLabelOptions(
				panelState.labels.show, panelState.labels.fontSize, panelState.labels.zoomThreshold,
				panelState.labels.maxCount, panelState.labels.scaleWithZoom
			);
			this.renderer.setEdgeStyle(panelState.edges.show, panelState.edges.width, panelState.edges.opacity);
			this.applyEncoding(this.plugin.settings.panel);
			this.applyOverlays(this.plugin.settings.panel);
			this.panel?.setOverlayCounts(countOverlayMatches(model));
			this.metricsClient?.compute(model);
			this.refreshTimelineData();
			this.syncTimelineAndTrail(this.plugin.settings.panel);
			const vocabulary = collectVocabulary(this.facts);
			this.searchBar?.setVocabulary(...vocabulary);
			this.filterChips?.setVocabulary(...vocabulary);
			this.updateEmptyState(model.nodes.length);
			this.syncWorkspaceQueryUi();
			if (this.hardQuery) await this.ensureContentIndex(contentNeedles(this.hardQuery));
		} catch (error) {
			if (generation === this.rebuildGeneration) this.model = null;
			throw error;
		} finally {
			if (generation === this.rebuildGeneration && !this.closing) {
				this.rebuilding = false;
				if (this.rebuildPending) {
					this.rebuildPending = false;
					this.rebuildDebounced();
				}
			}
		}
	}

	/**
	 * A vault with nothing in it renders as an empty black rectangle, which
	 * reads as a broken plugin rather than an empty vault. Say which it is.
	 */
	private updateEmptyState(nodeCount: number): void {
		if (nodeCount > 0) {
			this.emptyState?.remove();
			this.emptyState = null;
			return;
		}
		this.filteredEmptyState?.remove();
		this.filteredEmptyState = null;
		if (this.emptyState) return;
		this.emptyState = this.contentEl.createDiv({ cls: "graph-insight-empty" });
		this.emptyState.createDiv({ cls: "graph-insight-empty-title", text: t("empty.title") });
		this.emptyState.createDiv({ cls: "graph-insight-empty-body", text: t("empty.body") });
	}

	private updateFilteredEmptyState(visibleCount: number, hasRestrictions: boolean): void {
		if (visibleCount > 0 || !hasRestrictions || this.searchCounts.total === 0 || this.contentIndexJobs > 0) {
			this.filteredEmptyState?.remove();
			this.filteredEmptyState = null;
			return;
		}
		if (this.filteredEmptyState) return;
		this.filteredEmptyState = this.contentEl.createDiv({ cls: "graph-insight-empty graph-insight-filtered-empty" });
		this.filteredEmptyState.createDiv({ cls: "graph-insight-empty-title", text: t("filters.empty") });
		const reset = this.filteredEmptyState.createEl("button", { text: t("layers.showAll") });
		reset.addEventListener("click", () => void this.resetViewState());
	}

	/**
	 * A background worker died. The graph itself is still on screen, so say what
	 * stopped and offer the one action that fixes it rather than leaving the user
	 * with a view that has quietly gone still.
	 */
	private handleThemeChange(): void {
		this.renderer?.refreshThemeColors();
		this.applyEncoding(this.plugin.settings.panel);
	}

	/**
	 * The GPU took the canvas away. Pixi cannot restore its buffers in place, so
	 * the only honest fix is to build the view again — offered as a button
	 * rather than done behind the user's back, since a rebuild costs a relayout.
	 */
	private reportContextLost(): void {
		const message = new DocumentFragment();
		message.createDiv({ text: t("notice.contextLost") });
		const reload = message.createEl("button", { text: t("notice.contextReload") });
		reload.addClass("agv-notice-action");
		const notice = new Notice(message, 0);
		reload.addEventListener("click", () => {
			notice.hide();
			void this.reopen();
		});
	}

	/** Settings were replaced wholesale (import or reset) — start over. */
	reloadFromSettings(): Promise<void> {
		return this.reopen();
	}

	/** Tear the whole view down and build it again from saved settings. */
	private reopen(): Promise<void> {
		this.captureWorkspaceStateForReopen();
		this.reopenRequested = true;
		if (!this.reopenPromise) {
			const closeEpoch = this.closeEpoch;
			this.reopenPromise = this.runQueuedReopens(closeEpoch).finally(() => {
				this.reopenPromise = null;
			});
		}
		return this.reopenPromise;
	}

	private async runQueuedReopens(closeEpoch: number): Promise<void> {
		// Coalesce migration notifications already queued by the old window.
		await Promise.resolve();
		while (this.reopenRequested && closeEpoch === this.closeEpoch) {
			this.reopenRequested = false;
			this.clearOpenListeners();
			let teardownError: Error | undefined;
			try {
				await this.teardown();
			} catch (error) {
				teardownError = asError(error);
			}
			if (closeEpoch !== this.closeEpoch) return;
			let openError: Error | undefined;
			try {
				await this.onOpen();
			} catch (error) {
				openError = asError(error);
			}
			if (teardownError !== undefined) throw teardownError;
			if (openError !== undefined) throw openError;
		}
	}

	private async retryStartup(generation: number): Promise<void> {
		if (this.closing || this.openGeneration !== generation) return;
		await this.onOpen();
	}

	private reportWorkerFailure(kind: "layout" | "metrics"): void {
		const message = new DocumentFragment();
		message.createDiv({
			text: kind === "layout" ? t("notice.layoutWorkerFailed") : t("notice.metricsWorkerFailed"),
		});
		const retry = message.createEl("button", { text: t("notice.workerRetry") });
		retry.addClass("agv-notice-action");
		const notice = new Notice(message, 0);
		retry.addEventListener("click", () => {
			notice.hide();
			void this.restartWorker(kind);
		});
	}

	private async restartWorker(kind: "layout" | "metrics"): Promise<void> {
		if (kind === "metrics") {
			this.metricsClient?.stop();
			this.metricsClient = new MetricsClient(
				(metrics) => this.handleMetricsResult(metrics),
				() => this.reportWorkerFailure("metrics")
			);
			if (this.model) this.metricsClient.compute(this.model);
			return;
		}
		// The layout client tore itself down on the error; a rebuild spawns a
		// fresh worker. Clearing the model defeats the "nothing changed" guard,
		// which would otherwise make the rebuild a no-op.
		this.nativeHoverPreview?.clear();
		this.model = null;
		this.rebuilding = false;
		await this.rebuildGraph();
	}

	/** Worker finished PageRank + Louvain: enrich facts, refresh UI. */
	private handleMetricsResult(metrics: GraphMetrics): void {
		if (!this.model || this.facts.length !== metrics.pagerank.length) return;
		this.metrics = metrics;
		// F-10: metrics succeeded — the only moment history may grow.
		void this.plugin.maybeCaptureSnapshot(this.model, metrics);

		const clusterContent: ClusterContent[] = Array.from(
			{ length: metrics.communityCount },
			() => ({ titles: [], tags: [] })
		);
		for (const node of this.model.nodes) {
			const community = metrics.community[node.id];
			clusterContent[community].titles.push(node.name);
			clusterContent[community].tags.push(...this.facts[node.id].tags);
		}
		this.clusterNames = nameClusters(clusterContent);

		this.facts = this.facts.map((facts, id) => ({
			...facts,
			pagerank: metrics.pagerank[id],
			cluster: this.clusterNames[metrics.community[id]] ?? "",
		}));

		// Sort clusters by size for the panel; keep community id mapping.
		const sizes = clusterContent.map((c, id) => ({ id, size: c.titles.length }));
		sizes.sort((a, b) => b.size - a.size);
		this.clusterOrder = sizes.map((s) => s.id);
		this.hiddenClusters.clear();
		this.refreshClusterPanel();

		this.applyEncoding(this.plugin.settings.panel);
		this.redrawBubbles();
		this.apply3D(this.plugin.settings.panel, false);
	}

	private refreshClusterPanel(): void {
		// Cluster list UI removed by user request; clusters are still usable
		// through coloring, bubbles and the cluster:"name" search operator.
	}

	private clusterNodeIds(communityId: number): number[] {
		if (!this.metrics) return [];
		const ids: number[] = [];
		for (let i = 0; i < this.metrics.community.length; i++) {
			if (this.metrics.community[i] === communityId) ids.push(i);
		}
		return ids;
	}

	private zoomToCluster(rowIndex: number): void {
		const communityId = this.clusterOrder[rowIndex];
		if (communityId === undefined) return;
		this.renderer?.zoomToNodes(this.clusterNodeIds(communityId));
	}

	private toggleCluster(rowIndex: number): void {
		const communityId = this.clusterOrder[rowIndex];
		if (communityId === undefined || !this.metrics || !this.model) return;
		if (this.hiddenClusters.has(communityId)) this.hiddenClusters.delete(communityId);
		else this.hiddenClusters.add(communityId);
		this.recomputeVisual();
		this.refreshClusterPanel();
		this.redrawBubbles();
	}

	/** Overlay matches (orphans / dead ends / broken links) or null. */
	private overlayMask: Uint8Array | null = null;
	private lastOverlayKey = "";

	private applyOverlays(state: PanelState): void {
		if (!this.model || !this.renderer) return;
		const key = JSON.stringify(state.overlays);
		const changed = key !== this.lastOverlayKey;
		this.lastOverlayKey = key;

		this.overlayMask = computeOverlayMask(this.model, state.overlays);
		this.renderer.setDimMask(this.overlayMask);
		// Matches must also LIGHT UP, not merely survive the dimming.
		this.recomputeVisual();

		// Only report when the user actually flips a layer — every unrelated
		// panel change also runs through here.
		if (changed && this.overlayMask) {
			let matched = 0;
			for (const flag of this.overlayMask) matched += flag;
			const names: string[] = [];
			if (state.overlays.orphans) names.push(t("notice.layer.orphans"));
			if (state.overlays.deadEnds) names.push(t("notice.layer.deadEnds"));
			if (state.overlays.broken) names.push(t("notice.layer.broken"));
			new Notice(t("notice.highlighted", { count: matched, layers: names.join(", ") }));
		}
	}

	private redrawBubbles(): void {
		if (!this.renderer) return;
		if (!this.plugin.settings.panel.showBubbles || !this.metrics) {
			this.renderer.drawClusterHulls(null);
			return;
		}
		// Bubbles follow the active scheme so hulls match their node colors.
		const palette = activePreset(this.plugin.settings.panel.colorPreset, this.viewDocument ?? undefined).categories;
		const groups = this.clusterOrder
			.filter((communityId) => !this.hiddenClusters.has(communityId))
			.map((communityId) => ({
				nodeIds: this.clusterNodeIds(communityId),
				color: categoryColor(this.clusterNames[communityId] ?? String(communityId), palette),
			}));
		this.renderer.drawClusterHulls(groups);
	}

	/** Prefer live coordinates from the previous model, else saved positions.
	 *  Also reports which notes are pinned, by path: a rebuild reassigns node
	 *  ids, so the pins held in memory have to be re-resolved either way. */
	private async buildSeedPositions(
		model: GraphModel,
		renamed: ReadonlyMap<string, string> = this.renamed
	): Promise<{ seed: Float32Array | undefined; pinnedPaths: string[] }> {
		const previous = this.renderer?.currentPositions;
		const saved = previous ? null : await this.plugin.dataStore.loadPositions();
		const pinnedPaths = remapPinnedPaths(saved
			? saved.pins
			: [...this.explicitPins]
					.map((id) => this.model?.nodes[id]?.path)
					.filter((path): path is string => path !== undefined), renamed);
		if (!previous && !saved) return { seed: undefined, pinnedPaths };

		const knownPositions = new Map<number, SeedPosition>();
		for (const node of model.nodes) {
			if (previous && this.model) {
				const oldId = this.model.pathToId.get(resolvePreviousPath(node.path, renamed));
				if (oldId !== undefined) {
					knownPositions.set(node.id, [
						previous[oldId * 3],
						previous[oldId * 3 + 1],
						previous[oldId * 3 + 2],
					]);
				}
			} else if (saved) {
				const stored = saved.positions[resolvePreviousPath(node.path, renamed)];
				// Older files stored [x, y]; new ones store [x, y, z].
				if (stored) knownPositions.set(node.id, [stored[0], stored[1], stored[2] ?? 0]);
			}
		}
		const seed = buildNeighborSeed(model, knownPositions);
		return { seed, pinnedPaths };
	}

	/**
	 * Re-apply pins against the freshly built model. Node ids are assigned per
	 * build, so both sets are rebuilt from scratch: paths that no longer resolve
	 * belong to notes that have since been deleted or renamed away.
	 */
	private restorePins(
		model: GraphModel,
		seed: Float32Array | undefined,
		pinnedPaths: readonly string[]
	): void {
		this.explicitPins.clear();
		// Drag pins are per-session and the fresh simulation has none of them.
		this.pinnedNodes.clear();
		if (!seed) return;
		for (const path of pinnedPaths) {
			const id = model.pathToId.get(path);
			if (id === undefined) continue;
			this.explicitPins.add(id);
			this.layout?.pin(id, seed[id * 3], seed[id * 3 + 1], seed[id * 3 + 2]);
		}
		this.renderer?.setPinned(new Set(this.explicitPins));
	}

	private refreshFacts(files: TFile[]): void {
		// An incomplete view has no facts to refresh until its first build finishes.
		if (!this.model || this.facts.length !== this.model.nodes.length) return;
		const next = carryMetrics(this.facts, this.buildFacts(this.model, files));
		const { changed, groupingChanged } = diffFacts(this.facts, next);
		if (!changed) return;
		this.facts = next;
		this.tooltipNodeId = null;
		const panel = this.plugin.settings.panel;
		this.panel?.setPropertyKeys(collectPropertyKeys(this.facts, panel.channels.color));
		if (this.model) this.panel?.setOverlayCounts(countOverlayMatches(this.model));
		this.applyEncoding(panel);
		this.recomputeVisual();
		const vocabulary = collectVocabulary(this.facts);
		this.searchBar?.setVocabulary(...vocabulary);
		this.filterChips?.setVocabulary(...vocabulary);
		this.refreshTimelineData();
		if (groupingChanged) {
			this.appliedLayoutRule = null;
			this.applyLayoutRule(panel.layoutRule);
		}
	}

	private buildFacts(model: GraphModel, files: TFile[]): NodeFacts[] {
		const byPath = new Map(files.map((f) => [f.path, f]));
		const now = Date.now();
		const log = this.plugin.usageLog;

		return model.nodes.map((node) => {
			const file = byPath.get(node.path);
			const fileCache = file ? this.app.metadataCache.getFileCache(file) : null;
			const tags = fileCache ? (getAllTags(fileCache) ?? []).map((t) => t.replace(/^#/, "")) : [];
			return {
				path: node.path,
				folder: file?.parent?.path ?? "",
				tags,
				inCount: node.inCount,
				outCount: node.outCount,
				unresolvedCount: node.unresolvedCount,
				ctime: file?.stat.ctime ?? now,
				mtime: file?.stat.mtime ?? now,
				size: file?.stat.size ?? 0,
				opensTotal: log[node.path]?.total ?? 0,
				opens7: countRecentOpens(log, node.path, 7, now),
				opens30: countRecentOpens(log, node.path, 30, now),
				opens90: countRecentOpens(log, node.path, 90, now),
				pagerank: 0,
				cluster: "",
				properties: normalizeFrontmatterProperties(fileCache?.frontmatter),
			};
		});
	}

	private applyEncoding(state: PanelState): void {
		if (!this.renderer || this.facts.length === 0) return;
		const isLight = isLightTheme(this.viewDocument ?? undefined);
		const preset = activePreset(state.colorPreset, this.viewDocument ?? undefined);
		this.renderer.setVisualStyle(effectiveNodeStyle(state.nodeStyle, isLight), preset.backdrop ?? null);
		this.encoding = buildEncoding(
			this.facts, state.channels, state.colorPreset, Date.now(), isLight
		);
		const sizes = new Float32Array(this.encoding.sizes.length);
		for (let i = 0; i < sizes.length; i++) sizes[i] = this.encoding.sizes[i] * state.nodeScale;
		this.renderer.applyEncoding(sizes, this.encoding.tints, this.encoding.glow);
		this.legend?.update(state.channels.color, state.colorPreset, this.encoding.categories);
		this.redrawBubbles();
	}

	private receiveLayoutPositions(positions: Float32Array): void {
		if (this.closing || !this.renderer || !this.model || positions.length !== this.model.nodes.length * 3) return;
		this.renderer.updatePositions(positions);
		this.hasLayoutPositions = true;
	}

	flushPositions(): Promise<void> {
		return this.savePositions();
	}

	private async savePositions(): Promise<void> {
		const positions = this.renderer?.currentPositions;
		if (!positions || !this.model || !this.hasLayoutPositions) return this.positionWriter.flush();
		const map: PositionMap = {};
		const currentPaths = remapPinnedPaths(this.model.nodes.map((node) => node.path), this.renamed);
		for (const node of this.model.nodes) {
			map[currentPaths[node.id]] = [
				Math.round(positions[node.id * 3] * 10) / 10,
				Math.round(positions[node.id * 3 + 1] * 10) / 10,
				Math.round(positions[node.id * 3 + 2] * 10) / 10,
			];
		}
		// Pins travel as paths so they survive the id reshuffle of a rebuild.
		const pins: string[] = [];
		for (const id of this.explicitPins) {
			const path = currentPaths[id];
			if (path) pins.push(path);
		}
		await this.positionWriter.enqueue({ positions: map, pins });
	}

	private showTooltip(nodeId: number | null, clientX: number, clientY: number): void {
		return this.tooltipActions.showTooltip(nodeId, clientX, clientY);
	}

	private clearPreviewTimer(): void {
		return this.tooltipActions.clearPreviewTimer();
	}

	/** Read the note body off the main thread and append it to the tooltip,
	 *  unless the hover moved to another node while the read was pending. */
	private appendNotePreview(nodeId: number, words: number): Promise<void> {
		return this.tooltipActions.appendNotePreview(nodeId, words);
	}

	/** First `words` words of the note body (frontmatter stripped). */
	private notePreview(nodeId: number, words: number): Promise<string | null> {
		return this.tooltipActions.notePreview(nodeId, words);
	}

	private handleNodeClick(nodeId: number, event: PointerEvent): void {
		if (!this.model) return;
		// Explore picks a destination regardless of the normal cursor tool.
		if (this.isExploring) {
			this.navigateExploreTo(nodeId);
			return;
		}
		const node = this.model.nodes[nodeId];
		this.renderer?.setSelected(nodeId);

		switch (this.cursorTool) {
			case "links":
				this.enterFocus(nodeId);
				return;
			case "path":
				this.handlePathPick(nodeId);
				return;
			case "hide":
				this.hiddenNodes.add(nodeId);
				this.panel?.setHiddenNodeCount(this.hiddenNodes.size);
				this.recomputeVisual();
				return;
			case "pin": {
				const key = this.togglePin(nodeId) ? "notice.pinned" : "notice.unpinned";
				new Notice(t(key, { name: node.name }));
				return;
			}
			case "open":
				break;
		}
		// Cmd+Shift always splits and Cmd always opens a tab, whatever the mode.
		// A plain click goes through openNode, which is where side-pane mode
		// decides between the pane beside the graph and the last used one.
		const modifier = Keymap.isModEvent(event) !== false;
		if (modifier && event.shiftKey) {
			this.openNodeInSplit(nodeId);
			return;
		}
		this.openNode(nodeId, modifier);
	}

	// ── Command API (used by main.ts commands) ────────────────────────

	focusOnPath(path: string): void {
		const id = this.model?.pathToId.get(path);
		if (id !== undefined) this.enterFocus(id);
	}

	exportPngFile(): Promise<void> { return this.exportActions.exportPngFile(); }

	exportJsonFile(): void { this.exportActions.exportJsonFile(); }

	exportGexfFile(): void { this.exportActions.exportGexfFile(); }

	/** The ONE place panel callbacks are defined — panel is rebuilt from
	 *  here everywhere, so behavior can never diverge between copies. */
	private buildPanel(state: PanelState): ControlPanel {
		return new ControlPanel(this.contentEl, state, {
			onChange: (next) => {
				// A manual tweak diverges from the preset, so it's no longer "applied".
				this.activePresetIndex = null;
				// Any hand-made physics change invalidates the reset's Undo (F-07).
				const prev = this.plugin.settings.panel;
				if (next.physics !== prev.physics) this.physicsUndo = null;
				void this.plugin.savePanelState(next);
				this.applyAllPanelState(next, prev);
			},
			onPhysicsReset: () => void this.resetPhysics(),
			onSectionToggle: (id, open) => {
				if (id === "physics") void this.plugin.saveCollapsedSections({ physics: !open });
			},
			onTasksMenu: (anchor) => this.showTasksMenu(anchor),
			onReheat: () => this.regroup(),
			onClusterClick: (index) => this.zoomToCluster(index),
			onClusterToggle: (index) => this.toggleCluster(index),
			onTrailReplay: () => this.replayTrail(),
			onShowHiddenNodes: () => this.resetHiddenNodes(),
			onResetViewState: () => void this.resetViewState(),
			onPresetApply: (index) => void this.applyViewPreset(index),
			onPresetSaveRequest: () => {
				new PromptModal(this.app, t("prompt.presetTitle"), t("prompt.presetDefault"), (name) =>
					void this.saveViewPreset(name)
				).open();
			},
			onPresetDelete: (index) => void this.deleteViewPreset(index),
			onModeChange: (mode) => void this.plugin.savePanelMode(mode),
		}, this.plugin.settings.panelMode, this.plugin.settings.collapsedSections,
		collectPropertyKeys(this.facts, state.channels.color));
	}

	// ── View presets ──────────────────────────────────────────────────

	private async applyViewPreset(index: number): Promise<void> {
		await this.presetActions.applyViewPreset(index);
	}

	private async saveViewPreset(name: string): Promise<void> {
		await this.presetActions.saveViewPreset(name);
	}

	private async deleteViewPreset(index: number): Promise<void> {
		await this.presetActions.deleteViewPreset(index);
	}

	// ── F-01: canned task actions ─────────────────────────────────────

	/** The query a diagnostic task cleared; restorable until the next commit
	 *  or clear (see the search callbacks). */
	private taskQueryUndo: string | null = null;

	/** Stable action list: what the Tasks… menu and the commands both run. */
	static readonly TASK_ACTIONS = [
		{ id: "explore-topic", labelKey: "task.exploreTopic" },
		{ id: "attention-map", labelKey: "task.attention", presetId: "attention-map", diagnostic: true },
		{ id: "orphans", labelKey: "task.orphans", presetId: "orphans", diagnostic: true },
		{ id: "broken-links", labelKey: "task.broken", presetId: "broken-links", diagnostic: true },
		{ id: "recent", labelKey: "task.recent", presetId: "recent", diagnostic: false },
		{ id: "hubs-clusters", labelKey: "task.structure", presetId: "hubs-clusters", diagnostic: false },
	] as const;

	/** Entry point shared by the menu and the per-action commands. */
	runTask(taskId: (typeof GraphInsightView.TASK_ACTIONS)[number]["id"]): void {
		this.presetActions.runTask(taskId, GraphInsightView.TASK_ACTIONS);
	}

	/** Diagnostic tasks need the whole vault visible: drop the hard query but
	 *  keep it one click away until the next view-state change. */
	private clearHardQueryForTask(): void {
		if (!this.hardQueryText) return;
		const cleared = this.hardQueryText;
		this.taskQueryUndo = cleared;
		this.hardQuery = null;
		this.hardQueryText = "";
		this.lastWorkspaceQuery = "";
		this.searchParseError = undefined;
		this.recomputeVisual();
		this.scheduleWorkspaceSave();

		const fragment = createFragment();
		fragment.append(t("notice.queryCleared", { query: cleared }));
		const undo = createEl("button");
		undo.textContent = t("notice.undo");
		fragment.append(" ", undo);
		const notice = new Notice(fragment, 10000);
		undo.addEventListener("click", () => {
			notice.hide();
			if (this.taskQueryUndo === null) return;
			this.taskQueryUndo = null;
			this.searchBar?.applyQuery(cleared);
		});
	}

	private showTasksMenu(anchor: HTMLElement): void {
		this.menus.showTasksMenu(anchor);
	}

	private responsiveModeState: ResponsiveMode = "full";

	private applyResponsiveMode(mode: ResponsiveMode): void {
		if (mode === this.responsiveModeState) return;
		this.responsiveModeState = mode;
		this.contentEl.setAttribute("data-graph-responsive", mode);
		this.toolBar?.setResponsiveMode(mode);
	}

	/** F-04: everything the narrow widths hide, reachable from one menu —
	 *  and, through Obsidian's Menu, from the keyboard. */
	private showOverflowMenu(anchor: HTMLElement): void {
		this.menus.showOverflowMenu(anchor);
	}

	/** Undo target for "restore recommended physics", valid until the next
	 *  physics change (F-07). */
	private physicsUndo: PhysicsParams | null = null;

	/** F-07: swap the whole physics block for the recommended baseline in one
	 *  atomic update, list what changed, and offer Undo in the Notice. */
	private async resetPhysics(): Promise<void> {
		const settings = this.plugin.settings;
		const active =
			this.activePresetIndex !== null
				? settings.viewPresets[this.activePresetIndex] ?? null
				: null;
		const baseline = recommendedPhysics(active, settings.panel.view3d.enabled);
		const diff = physicsDiff(settings.panel.physics, baseline);
		if (diff.length === 0) return;
		const previous = settings.panel.physics;
		await this.updatePanelState((state) => ({ ...state, physics: { ...baseline } }));
		this.physicsUndo = previous;

		const fragment = createFragment();
		fragment.append(t("notice.physicsReset", { diff: formatPhysicsDiff(diff) }));
		const undo = createEl("button");
		undo.textContent = t("notice.undo");
		fragment.append(" ", undo);
		const notice = new Notice(fragment, 10000);
		undo.addEventListener("click", () => {
			notice.hide();
			void this.undoPhysicsReset();
		});
	}

	private async undoPhysicsReset(): Promise<void> {
		if (!this.physicsUndo) return;
		const previous = this.physicsUndo;
		this.physicsUndo = null;
		await this.updatePanelState((state) => ({ ...state, physics: previous }));
	}

	/** Apply every visual consequence of a panel state, in one place. */
	private applyAllPanelState(state: PanelState, prev?: PanelState): void {
		const diff = panelDiff(prev, state);
		if (diff.applyEncoding) this.applyEncoding(state);
		if (diff.applyOverlays) this.applyOverlays(state);
		if (diff.redrawBubbles) this.redrawBubbles();
		if (diff.syncTimelineAndTrail) this.syncTimelineAndTrail(state);
		this.applyPhysics(state);
		this.applyLayoutRule(state.layoutRule);
		this.renderer?.setLabelOptions(
			state.labels.show, state.labels.fontSize, state.labels.zoomThreshold,
			state.labels.maxCount, state.labels.scaleWithZoom
		);
		this.renderer?.setEdgeStyle(state.edges.show, state.edges.width, state.edges.opacity);
		this.apply3D(state, true);
	}

	/** Toggle helpers for commands and the corner widget. */
	async updatePanelState(mutate: (state: PanelState) => PanelState): Promise<void> {
		const next = mutate(this.plugin.settings.panel);
		await this.plugin.savePanelState(next);
		this.panel?.destroy();
		this.panel = this.buildPanel(next);
		this.panel.setViewPresets(this.presetRows(this.plugin.settings.viewPresets));
		this.panel.setSelectedPreset(this.activePresetIndex);
		if (this.model) this.panel.setOverlayCounts(countOverlayMatches(this.model));
		this.panel.setHiddenNodeCount(this.hiddenNodes.size);
		this.refreshClusterPanel();
		this.applyAllPanelState(next);
	}

	private last3DKey = "";

	/** Sync renderer camera + physics dimensionality with 3D settings. */
	private apply3D(state: PanelState, allowRestart: boolean): void {
		if (!this.renderer || !this.model) return;
		const key = JSON.stringify(state.view3d);
		const changed = key !== this.last3DKey;
		this.last3DKey = key;

		this.renderer.set3DMode(state.view3d.enabled);
		this.renderer.setCameraFocal(state.view3d.focal);
		this.renderer.setDepthOverride(this.computeDepthOverride(state));
		this.cameraWidget?.sync(state.view3d, state.physics.freeLayout);

		// Switching physics-sphere on/off changes simulation dimensionality.
		// Never restart while a node is being dragged — the restart would
		// wipe the drag pin out from under the pointer.
		if (changed && allowRestart && !this.renderer.isDragging) {
			const seed = this.renderer.currentPositions ?? undefined;
			const dims = state.view3d.enabled && state.view3d.depthSource === "physics" ? 3 : 2;
			this.layout?.start(this.model, seed ? new Float32Array(seed) : undefined, dims);
			this.layout?.setParams(state.physics);
		}
	}

	private computeDepthOverride(state: PanelState): Float32Array | null {
		if (!state.view3d.enabled || state.view3d.depthSource === "physics" || !this.model) return null;
		if (state.view3d.depthSource === "cluster" && this.metrics) {
			return depthByCluster(this.metrics.community, this.metrics.communityCount);
		}
		if (state.view3d.depthSource === "age") {
			return depthByAge(this.facts);
		}
		return new Float32Array(this.model.nodes.length);
	}

	private lastPhysics = "";

	private lastFreeLayout: boolean | null = null;

	/** Push slider values into the layout worker; reheat so they take hold. */
	private applyPhysics(state: PanelState): void {
		// Bigger nodes need proportionally more elbow room, so fold node size
		// into the collision radius and the change key.
		const collideRadius = COLLIDE_BASE_RADIUS * state.nodeScale;
		const key = `${JSON.stringify(state.physics)}|${state.nodeScale}`;
		if (key === this.lastPhysics) return;
		this.lastPhysics = key;
		// Slider values are tuned for a mid-size vault; rescale the spread to
		// the actual node count before handing them to the worker.
		const adapted = adaptPhysicsToGraphSize(state.physics, this.model?.nodes.length ?? 0);
		this.layout?.setParams({ ...adapted, collideRadius });

		// Physics off: the worker freezes itself; don't reheat it back to life.
		if (state.physics.disabled) return;

		// Toggling «Свободно» re-forms the whole layout: drop the temporary
		// pins left by dragging (explicit pins stay) and run the simulation
		// at full strength so everything flies back into a cloud.
		const freeChanged =
			this.lastFreeLayout !== null && this.lastFreeLayout !== state.physics.freeLayout;
		this.lastFreeLayout = state.physics.freeLayout;
		if (freeChanged) {
			this.regroup();
			return;
		}
		this.layout?.reheat();
	}

	/** Release drag pins and re-run the layout from scratch. */
	private regroup(): void {
		for (const id of this.pinnedNodes) {
			if (!this.explicitPins.has(id)) this.layout?.unpin(id);
		}
		this.pinnedNodes.clear();
		this.layout?.reheat(1);
	}

	/** The rule the layout worker currently groups by; null after a rebuild so
	 *  the persisted rule is recomputed against the fresh facts. */
	private appliedLayoutRule: LayoutRule | null = null;

	/** Choose what pulls notes together: their links (default force layout), or
	 *  a shared tag / folder clustering them into clumps. No-op when the rule
	 *  is already applied, so panel tweaks don't reheat the layout for nothing. */
	private applyLayoutRule(rule: LayoutRule): void {
		if (!this.layout || rule === this.appliedLayoutRule) return;
		this.appliedLayoutRule = rule;
		this.layout.setCluster(rule === "links" ? null : computeGroups(rule, this.facts, Date.now()));
		this.layout.reheat(0.6);
	}

	/** True when there is any temporary visual state Esc could clear. */
	private hasActiveViewState(): boolean {
		return (
			this.hiddenNodes.size > 0 ||
			this.hiddenClusters.size > 0 ||
			this.softQuery !== null ||
			this.hardQuery !== null ||
			this.pathAnchor !== null ||
			this.pathDrawn ||
			this.chipFilter.tags.size > 0 ||
			this.chipFilter.folders.size > 0
			|| this.timelineCutoff !== null
			|| this.changesHighlight !== null
		);
	}

	/** One button to undo every temporary visual state. */
	private async resetViewState(): Promise<void> {
		if (this.isExploring) await this.exitExplore();
		if (this.focusRootId !== null) this.exitFocus();
		this.hiddenNodes.clear();
		this.hiddenClusters.clear();
		this.softQuery = null;
		this.hardQuery = null;
		this.hardQueryText = "";
		this.lastWorkspaceQuery = "";
		this.searchParseError = undefined;
		this.pathAnchor = null;
		this.toolBar?.setPathStage("start");
		this.focusRootId = null;
		this.focusBar?.hide();
		this.chipFilter = { tags: new Set(), folders: new Set() };
		this.timelineCutoff = null;
		this.timeline?.resetCutoff();
		this.changesSelection = { ...this.changesSelection, category: null };
		this.changesHighlight = null;
		this.changesPanel?.setState(this.changesSelection.periodDays, null);
		this.filterChips?.setSelection(this.chipFilter);
		void this.plugin.saveChipFilter({ tags: [], folders: [] });
		this.searchBar?.resetInput();
		this.renderer?.setSelected(null);
		this.renderer?.setHighlightMask(null);
		this.renderer?.setAlphaFactors(null);
		this.renderer?.setPathHighlight(null);
		this.pathDrawn = false;
		this.panel?.setHiddenNodeCount(0);
		this.recomputeVisual();
		this.scheduleWorkspaceSave();
		new Notice(t("notice.viewStateReset"));
	}

	private resetHiddenNodes(): void {
		this.hiddenNodes.clear();
		this.panel?.setHiddenNodeCount(0);
		this.recomputeVisual();
	}

	// ── Timeline & session trail ──────────────────────────────────────

	private refreshTimelineData(): void {
		if (!this.timeline) return;
		const times = this.facts.map((f) => (this.timelineMode === "created" ? f.ctime : f.mtime));
		this.timeline.setTimestamps(times);
	}

	private syncTimelineAndTrail(state: PanelState): void {
		if (state.showTimeline) this.timeline?.show();
		else this.timeline?.hide();
		this.drawTrail(state.showTrail ? 1 : null);
	}

	/** progress null = clear; otherwise 0..1 of the path drawn. */
	private drawTrail(progress: number | null): void {
		if (!this.renderer || !this.model) return;
		if (progress === null) {
			this.renderer.setSessionTrail(null);
			return;
		}
		const ids: number[] = [];
		for (const entry of this.plugin.sessionTrail) {
			const id = this.model.pathToId.get(entry.path);
			if (id === undefined) continue;
			if (ids.length > 0 && ids[ids.length - 1] === id) continue;
			ids.push(id);
		}
		this.renderer.setSessionTrail(ids, progress);
	}

	private replayTrail(): void {
		const viewWindow = this.viewWindow ?? this.renderer?.ownerWindow ?? window;
		if (this.trailReplayFrame !== null) viewWindow.cancelAnimationFrame(this.trailReplayFrame);
		this.trailReplayFrame = null;
		if (prefersReducedMotion(viewWindow)) {
			this.drawTrail(1);
			return;
		}
		const durationMs = motionMs(TRAIL_REPLAY_MS, viewWindow);
		const start = viewWindow.performance.now();
		const generation = this.openGeneration;
		const step = () => {
			if (generation !== this.openGeneration) return;
			const progress = Math.min(1, (viewWindow.performance.now() - start) / durationMs);
			this.drawTrail(progress);
			if (progress < 1) this.trailReplayFrame = viewWindow.requestAnimationFrame(step);
			else this.trailReplayFrame = null;
		};
		this.trailReplayFrame = viewWindow.requestAnimationFrame(step);
	}

	onResize(): void {
		this.renderer?.resize();
	}

	async onClose(): Promise<void> {
		this.captureWorkspaceStateForReopen();
		this.closeEpoch++;
		this.reopenRequested = false;
		await this.teardown();
	}

	private async teardown(): Promise<void> {
		this.nativeHoverPreview?.destroy();
		this.nativeHoverPreview = null;
		this.closing = true;
		this.cancelWorkspaceSave();
		this.openGeneration++;
		this.clearOpenListeners();
		this.stopObservingRendererVisibility?.();
		this.stopObservingRendererVisibility = null;
		const viewWindow = this.viewWindow;
		if (this.resizeFrame !== null) viewWindow?.cancelAnimationFrame(this.resizeFrame);
		if (this.trailReplayFrame !== null) viewWindow?.cancelAnimationFrame(this.trailReplayFrame);
		if (this.visualFrame !== null) viewWindow?.cancelAnimationFrame(this.visualFrame);
		this.resizeFrame = null;
		this.trailReplayFrame = null;
		this.visualFrame = null;
		this.rebuildGeneration++;
		this.rebuilding = false;
		this.rebuildPending = false;
		this.changesGeneration++;
		this.floatingLayout?.destroy();
		this.floatingLayout = null;
		this.exploreNoteModal?.close();
		this.exploreNoteModal = null;
		// Cancel in-flight note scans before their reads can finish on a closed view.
		this.contentIndexGeneration++;
		this.contentIndex.clear();
		this.hardQuery = null;
		// Forget the companion pane without closing it: the note in it is the
		// user's, and they may well still be reading it.
		this.companionLeafId = null;
		this.clearPreviewTimer();
		this.exploreSession?.stop();
		this.exploreSession = null;
		this.exploreDetached = false;
		this.exploreOverride = false;
		let persistenceError: Error | undefined;
		try {
			const results = await Promise.allSettled([
				callAsPromise(() => this.savePositions()),
				callAsPromise(() => this.plugin.flushSettings()),
			]);
			const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
			if (rejected) {
				persistenceError = asError(rejected.reason);
			}
		} finally {
			this.finishTeardown();
		}
		if (persistenceError) throw persistenceError;
	}

	private finishTeardown(): void {
		this.renamed.clear();
		this.hasLayoutPositions = false;
		this.layout?.stop();
		this.layout = null;
		this.changesClient?.stop();
		this.changesClient = null;
		this.changesPanel?.destroy();
		this.changesPanel = null;
		this.metricsClient?.stop();
		this.metricsClient = null;
		this.searchBar?.destroy();
		this.searchBar = null;
		this.toolBar?.destroy();
		this.toolBar = null;
		this.filterChips?.destroy();
		this.filterChips = null;
		this.timeline?.destroy();
		this.timeline = null;
		this.cameraWidget?.destroy();
		this.cameraWidget = null;
		this.panel?.destroy();
		this.panel = null;
		this.legend?.destroy();
		this.legend = null;
		this.renderer?.destroy();
		this.renderer = null;
		this.model = null;
		this.viewWindow = null;
		this.viewDocument = null;
	}
}

function callAsPromise<T>(action: () => Promise<T>): Promise<T> {
	try {
		return Promise.resolve(action());
	} catch (error) {
		return Promise.reject(asError(error));
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/** Unique tags and folders for search suggestions, sorted by frequency. */
function collectVocabulary(facts: NodeFacts[]): [string[], string[]] {
	const tagCounts = new Map<string, number>();
	const folderCounts = new Map<string, number>();
	for (const f of facts) {
		for (const tag of f.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		if (f.folder && f.folder !== "/") folderCounts.set(f.folder, (folderCounts.get(f.folder) ?? 0) + 1);
	}
	const byCount = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);
	return [byCount(tagCounts), byCount(folderCounts)];
}
