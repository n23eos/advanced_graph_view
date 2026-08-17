import {
	ItemView,
	Keymap,
	Menu,
	Notice,
	TFile,
	debounce,
	getAllTags,
	type TAbstractFile,
	type View,
	type WorkspaceLeaf,
} from "obsidian";
import { buildAdjacency, computeDistances, focusFalloff, shortestPath } from "../analysis/focus";
import { nameClusters, type ClusterContent } from "../analysis/clusterNames";
import { computeOverlayMask, countOverlayMatches } from "../analysis/overlays";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { stripMarkdown } from "../data/stripMarkdown";
import { countRecentOpens } from "../data/UsageTracker";
import type { PositionMap } from "../data/persistence";
import { buildEncoding, type NodeEncoding } from "../encoding/encode";
import { categoryColor } from "../encoding/colorScales";
import { activePreset, isLightTheme } from "../render/theme";
import type { NodeFacts } from "../encoding/metrics";
import { ExploreSession } from "../explore/ExploreSession";
import { DEFAULT_EXPLORE_TUNING } from "../explore/ExploreController";
import { chooseCompanionAction } from "./companionPane";
import { motionMs, motionSeconds } from "../render/motion";
import { GraphRenderer } from "../render/GraphRenderer";
import { ControlPanel, type PanelState } from "../ui/ControlPanel";
import { Legend } from "../ui/Legend";
import { LayoutClient } from "../workers/LayoutClient";
import { AutoFitGate, shouldFitOnSettle } from "./autoFitGate";
import { adaptPhysicsToGraphSize } from "../ui/layoutDensity";
import type { LayoutRule, PhysicsParams } from "../workers/layoutEngine";
import { formatPhysicsDiff, physicsDiff, recommendedPhysics } from "../ui/physicsReset";
import { responsiveMode, type ResponsiveMode } from "../ui/responsive";
import { ensureBuiltinPreset } from "./builtinPresets";
import type { BuiltinPresetId } from "./presetNames";
import { NavigationTrail } from "../explore/navigationTrail";
import { renderBreadcrumb } from "../ui/breadcrumb";
import {
	nextAvailableName,
	topicMapMarkdown,
	type TopicMapInput,
	type TopicMapSource,
} from "../export/topicMapMarkdown";
import { buildNeighborhood } from "../analysis/neighborhood";
import {
	ExportConflictModal,
	TopicMapExportModal,
	type TopicMapExportDraft,
} from "../ui/TopicMapExportModal";
import { ChangesPanel, type ChangesData } from "../ui/ChangesPanel";
import { ChangesClient } from "../workers/ChangesClient";
import {
	coolingClusters,
	notesChangedSince,
	type ChangeCategory,
	type LinkChange,
	type TopologyDiff,
} from "../analysis/graphChanges";
import { closestSnapshotBefore } from "../data/graphSnapshots";
import { MetricsClient, type GraphMetrics } from "../workers/MetricsClient";
import {
	contentNeedles, parseQuery, matchesQuery, validateQuery,
	type ParsedQuery, type QueryDiagnostic,
} from "../query/QueryParser";
import { SearchBar, type SearchMode } from "../ui/SearchBar";
import type { SearchPreset } from "../settings/schema";
import { sortSearchPresets } from "../settings/searchPresets";
import { SearchPresetModal } from "../ui/SearchPresetModal";
import { SearchPresetManagerModal } from "../ui/SearchPresetManagerModal";
import { FilterChips, type FilterSelection } from "../ui/FilterChips";
import { PromptModal } from "../ui/PromptModal";
import { TimelineBar, type TimelineMode } from "../ui/TimelineBar";
import { CameraWidget } from "../ui/CameraWidget";
import { ToolBar, type CursorTool } from "../ui/ToolBar";
import { graphToGexf, graphToJson } from "../export/exporters";
import { computeGroups, depthByAge, depthByCluster } from "./layoutGrouping";
import { presetDisplayName } from "./presetNames";
import { resolveFollowAction } from "./followActiveNote";
import { t } from "../i18n";
import type GraphInsightPlugin from "../main";
import type { ViewPreset } from "./builtinPresets";

export const GRAPH_INSIGHT_VIEW_TYPE = "graph-insight-view";

const POSITION_SAVE_DEBOUNCE_MS = 5000;
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
	private renderer: GraphRenderer | null = null;
	private layout: LayoutClient | null = null;
	/** Frames the graph after the first layout and after a preset switch. */
	private readonly autoFit = new AutoFitGate();
	private metricsClient: MetricsClient | null = null;
	private model: GraphModel | null = null;
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
	private legend: Legend | null = null;
	/** Pane beside the graph that notes open into while side-pane mode is on.
	 *  Remembered by id, not by object: Obsidian can rebuild the leaf behind
	 *  the same id, and a stale object reference made every click split again. */
	private companionLeafId: string | null = null;
	/** Placeholder shown instead of a blank canvas when the vault has no notes. */
	private emptyState: HTMLElement | null = null;
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
	/** A vault change arrived while exploring; rebuild once the mode ends. */
	private rebuildDeferred = false;

	private rebuildDebounced = debounce(() => void this.rebuildGraph(), 2000, true);
	private rebuilding = false;

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

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("graph-insight-container");

		this.tooltip = container.createDiv({ cls: "graph-insight-tooltip" });
		this.tooltip.hide();

		// Any manual pan/zoom/drag means the user framed the view themselves —
		// a later auto-fit must not yank the camera out of their hands.
		this.registerDomEvent(container, "pointerdown", () => this.autoFit.cancel());
		this.registerDomEvent(container, "wheel", () => this.autoFit.cancel());

		this.renderer = new GraphRenderer({
			onNodeHover: (nodeId, clientX, clientY) => this.showTooltip(nodeId, clientX, clientY),
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
		await this.renderer.init(container);
		// The pane may not have its final size during onOpen; resize once the
		// layout settles so the canvas fills the whole view.
		window.requestAnimationFrame(() => this.renderer?.resize());

		this.layout = new LayoutClient(
			(positions) => this.renderer?.updatePositions(positions),
			(positions) => {
				this.renderer?.updatePositions(positions);
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

		this.searchBar = new SearchBar(container, {
			onQueryChange: (query) => {
				this.softQuery = query.trim() ? parseQuery(query) : null;
				this.searchParseError = undefined;
				this.recomputeVisual();
			},
			onCommit: (query) => {
				const trimmed = query.trim();
				this.searchParseError = undefined;
				// Any new commit is a view-state change: the task's undo expires.
				this.taskQueryUndo = null;
				if (trimmed) {
					const diagnostic = validateQuery(trimmed);
					if (diagnostic) {
						// A broken query never becomes the hard filter — the last
						// valid one stays applied and the bar shows what's wrong.
						this.searchParseError = diagnostic;
						this.pushSearchUi();
						return;
					}
				}
				this.hardQuery = trimmed ? parseQuery(trimmed) : null;
				this.hardQueryText = trimmed;
				this.softQuery = null;
				this.recomputeVisual();
				// content:/слово: terms need note text — build the index
				// asynchronously, then re-filter.
				if (this.hardQuery) void this.ensureContentIndex(contentNeedles(this.hardQuery));
			},
			onClear: () => {
				this.softQuery = null;
				this.hardQuery = null;
				this.hardQueryText = "";
				this.searchParseError = undefined;
				this.taskQueryUndo = null;
				this.recomputeVisual();
			},
			onSavePreset: (query) => this.savePreset(query),
			onPresetApplied: (id) => void this.markPresetUsed(id),
			onManagePresets: () => this.openPresetManager(),
			onTasksMenu: (anchor) => this.showTasksMenu(anchor),
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

		// F-04: the floating UI adapts to the pane's width, not the window's.
		// Attribute + status text only — the canvas is never rebuilt for this.
		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver((entries) => {
				const width = entries[0]?.contentRect.width ?? container.clientWidth;
				this.applyResponsiveMode(responsiveMode(width));
			});
			observer.observe(container);
			this.register(() => observer.disconnect());
		}

		this.focusBar = container.createDiv({ cls: "graph-insight-focusbar" });
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

		// Capture phase, and the explore keys are swallowed outright.
		// `preventDefault` alone is not enough: Obsidian's own key handling is
		// registered on the document before any plugin's, so a bubbling
		// listener runs *after* the app has already acted on Esc — which is
		// why Esc used to look like it closed the whole view.
		this.registerDomEvent(
			document,
			"keydown",
			(event) => this.handleKeyDown(event),
			{ capture: true }
		);

		await this.rebuildGraph();

		this.registerEvent(this.app.metadataCache.on("resolved", () => this.rebuildDebounced()));
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => this.handleActiveNoteChanged(file))
		);
		// Theme switch or a newly installed theme: node, edge and label colors
		// all come from CSS variables, and the scheme itself is dimmed on light
		// themes — both have to be re-read, not just repainted.
		this.registerEvent(this.app.workspace.on("css-change", () => this.handleThemeChange()));

		if (this.plugin.settings.onboardingState === "never-seen") {
			this.plugin.showOnboarding();
		}
	}

	private handleKeyDown(event: KeyboardEvent): void {
		if (!this.contentEl.isShown()) return;
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
			this.resetViewState();
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
			buildAdjacency(this.model),
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
					const target = trail.jumpTo(index);
					const id = target ? this.model?.pathToId.get(target.path) : undefined;
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
		if (this.changesPanel?.isShown) {
			this.changesPanel.hide();
			return;
		}
		this.ensureChangesPanel();
		this.changesPanel?.show();
		void this.refreshChanges();
	}

	private ensureChangesPanel(): void {
		if (this.changesPanel) return;
		this.changesPanel = new ChangesPanel(this.contentEl, {
			onPeriodChange: (days) => {
				this.changesSelection = { ...this.changesSelection, periodDays: days };
				this.changesPanel?.setState(days, this.changesSelection.category);
				void this.refreshChanges();
			},
			onCategorySelect: (category) => this.selectChangesCategory(category),
			onOpenNote: (path) => {
				const id = this.model?.pathToId.get(path);
				if (id !== undefined) this.openNode(id, !this.plugin.settings.openInSidePane);
			},
			onFocusLink: (link) => this.focusChangesLink(link),
			onFocusCluster: (id) => this.renderer?.zoomToNodes(this.clusterNodeIds(id)),
			onClose: () => this.changesPanel?.hide(),
		});
		this.changesPanel.setState(this.changesSelection.periodDays, this.changesSelection.category);
	}

	private async refreshChanges(): Promise<void> {
		if (!this.model) return;
		this.changesPanel?.setData(null); // skeleton — the view stays interactive
		const now = Date.now();
		const periodStart = now - this.changesSelection.periodDays * 24 * 60 * 60 * 1000;
		const snapshot = closestSnapshotBefore(this.plugin.snapshotStore, periodStart);

		const nodes = this.model.nodes.map((node) => ({
			path: node.path,
			ctime: this.facts[node.id]?.ctime ?? 0,
			mtime: this.facts[node.id]?.mtime ?? 0,
		}));
		const { newNotes, editedNotes } = notesChangedSince(nodes, periodStart);

		const hasMetrics = this.metrics !== null;
		const cooling = this.metrics
			? coolingClusters(
					this.plugin.usageLog,
					this.model,
					this.metrics.community,
					this.metrics.communityCount,
					this.changesSelection.periodDays,
					now
				).map((id) => ({ id, label: this.clusterNames[id] ?? `#${id}` }))
			: [];

		let diff: TopologyDiff = { addedLinks: [], removedLinks: [], growingHubs: [] };
		if (snapshot) {
			this.changesClient ??= new ChangesClient();
			try {
				diff = await this.changesClient.compute(snapshot, this.model, this.metrics?.pagerank ?? null);
			} catch {
				// A second refresh while one runs: keep the empty diff.
			}
		}

		this.changesData = {
			hasHistory: snapshot !== null,
			hasMetrics,
			newNotes,
			editedNotes,
			addedLinks: diff.addedLinks,
			removedLinks: diff.removedLinks,
			growingHubs: hasMetrics || diff.growingHubs.length > 0 ? diff.growingHubs : [],
			coolingClusters: cooling,
		};
		this.changesPanel?.setData(this.changesData);
		this.applyChangesMask();
	}

	private selectChangesCategory(category: ChangeCategory | null): void {
		this.changesSelection = { ...this.changesSelection, category };
		this.changesPanel?.setState(this.changesSelection.periodDays, category);
		this.applyChangesMask();
	}

	/** Fold the selected category into a highlight set; recomputeVisual owns
	 *  the masks, so no rebuild and no extra pass (§F-10). */
	private applyChangesMask(): void {
		const { category } = this.changesSelection;
		const data = this.changesData;
		if (!category || !data || !this.model) {
			this.changesHighlight = null;
			this.recomputeVisual();
			return;
		}
		const ids = new Set<number>();
		const addPath = (path: string) => {
			const id = this.model?.pathToId.get(path);
			if (id !== undefined) ids.add(id);
		};
		switch (category) {
			case "new-notes": data.newNotes.forEach(addPath); break;
			case "edited-notes": data.editedNotes.forEach(addPath); break;
			case "growing-hubs": data.growingHubs.forEach(addPath); break;
			case "added-links":
			case "removed-links": {
				const links = category === "added-links" ? data.addedLinks : data.removedLinks;
				for (const link of links) {
					addPath(link.fromPath);
					addPath(link.toPath);
				}
				break;
			}
			case "cooling-clusters":
				for (const cluster of data.coolingClusters) {
					for (const id of this.clusterNodeIds(cluster.id)) ids.add(id);
				}
				break;
		}
		this.changesHighlight = ids;
		this.recomputeVisual();
	}

	/** A link row focuses both ends and lights the edge up, like the path tool. */
	private focusChangesLink(link: LinkChange): void {
		const from = this.model?.pathToId.get(link.fromPath);
		const to = this.model?.pathToId.get(link.toPath);
		if (from === undefined || to === undefined) return;
		this.renderer?.setPathHighlight([from, to]);
		this.pathDrawn = true;
		this.renderer?.zoomToNodes([from, to]);
	}

	// ── F-12: topic map export ────────────────────────────────────────

	/** The one cluster left visible when a cluster filter hides all others —
	 *  the "unambiguous cluster" the export can act on. */
	private singleVisibleCluster(): number | null {
		if (!this.metrics || this.hiddenClusters.size === 0) return null;
		const visible: number[] = [];
		for (let c = 0; c < this.metrics.communityCount; c++) {
			if (!this.hiddenClusters.has(c)) visible.push(c);
		}
		return visible.length === 1 ? visible[0] : null;
	}

	/** Whether the command palette entry has anything to export. */
	canExportTopicMap(): boolean {
		return this.focusRootId !== null || this.exploreFocus !== null || this.singleVisibleCluster() !== null;
	}

	/** Command entry: pick the active source (focus > explore > cluster). */
	exportCurrentTopicMap(): void {
		if (this.focusRootId !== null) {
			this.openTopicMapExport("focus", this.focusRootId);
			return;
		}
		if (this.exploreFocus) {
			this.openTopicMapExport("explore", this.exploreFocus.centerId);
			return;
		}
		const cluster = this.singleVisibleCluster();
		if (cluster === null || !this.metrics || !this.model) return;
		const nodeIds: number[] = [];
		for (let i = 0; i < this.model.nodes.length; i++) {
			if (this.metrics.community[i] === cluster) nodeIds.push(i);
		}
		this.openTopicMapExport("cluster", null, nodeIds);
	}

	private openTopicMapExport(
		source: TopicMapSource,
		rootId: number | null,
		flatIds: number[] = []
	): void {
		if (!this.model) return;
		const root = rootId !== null ? this.model.nodes[rootId] : null;
		new TopicMapExportModal(
			this.app,
			{
				name: root ? `${t("topicmap.modalTitle")} — ${root.name}` : t("topicmap.modalTitle"),
				// §13.4: default next to the root note; vault root for lasso.
				folder: root ? root.path.slice(0, Math.max(root.path.lastIndexOf("/"), 0)) : "",
				depth: Math.min(Math.max(this.focusDepth, 1), 4),
				includeDirections: true,
				includeMetrics: true,
				includeInternalLinks: true,
			},
			rootId !== null,
			(draft) => void this.writeTopicMap(source, rootId, flatIds, draft)
		).open();
	}

	private async writeTopicMap(
		source: TopicMapSource,
		rootId: number | null,
		flatIds: number[],
		draft: TopicMapExportDraft
	): Promise<void> {
		if (!this.model) return;
		const input: TopicMapInput =
			rootId !== null
				? { kind: "rooted", neighborhood: buildNeighborhood(this.model, rootId, draft.depth) }
				: { kind: "flat", model: this.model, nodeIds: flatIds };
		const body = topicMapMarkdown(input, {
			source,
			generatedAt: new Date().toISOString(),
			includeDirections: draft.includeDirections,
			includeMetrics: draft.includeMetrics,
			includeInternalLinks: draft.includeInternalLinks,
		});

		const folder = draft.folder.replace(/^\/+|\/+$/g, "");
		const fileName = `${draft.name.replace(/[\\/:]/g, "-")}.md`;
		const target = folder ? `${folder}/${fileName}` : fileName;
		const taken = (path: string) => this.app.vault.getAbstractFileByPath(path) !== null;

		if (!taken(target)) {
			await this.createTopicMapFile(target, folder, body);
			return;
		}
		new ExportConflictModal(this.app, fileName, (choice) => {
			if (choice === "cancel") return;
			if (choice === "copy") {
				void this.createTopicMapFile(nextAvailableName(target, taken), folder, body);
				return;
			}
			const existing = this.app.vault.getAbstractFileByPath(target);
			if (existing instanceof TFile) {
				this.app.vault
					.modify(existing, body)
					.then(() => new Notice(t("notice.topicMapExported", { name: existing.path })))
					.catch(() => new Notice(t("notice.topicMapFailed")));
			} else {
				// The file vanished between the conflict check and the choice.
				new Notice(t("notice.topicMapFailed"));
			}
		}).open();
	}

	private async createTopicMapFile(path: string, folder: string, body: string): Promise<void> {
		try {
			if (folder && this.app.vault.getAbstractFileByPath(folder) === null) {
				await this.app.vault.createFolder(folder);
			}
			await this.app.vault.create(path, body);
			new Notice(t("notice.topicMapExported", { name: path }));
		} catch {
			// vault.create never leaves a half-written file behind.
			new Notice(t("notice.topicMapFailed"));
		}
	}

	/** Backspace and the Back button both walk the same trail model (F-11). */
	private exploreBack(): void {
		const target = this.exploreTrail?.back();
		if (!target) return;
		const id = this.model?.pathToId.get(target.path);
		if (id !== undefined) this.exploreSession?.travelTo(id);
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
	async enterExplore(startId?: number): Promise<void> {
		if (!this.renderer || !this.model || this.exploreSession) return;
		const centerId = startId ?? this.renderer.nodeNearestToViewCenter();
		if (centerId === null) {
			new Notice(t("notice.exploreNoNode"));
			return;
		}

		const reanchoring = this.exploreDetached;
		// A re-anchor continues the same trip; only a fresh entry starts a
		// new history (F-11). The trail never survives leaving the mode.
		if (!reanchoring || !this.exploreTrail) this.exploreTrail = new NavigationTrail("explore");
		if (!this.exploreOverride) {
			this.exploreOverride = true;
			this.applyExploreOverride();
		}
		this.exploreDetached = false;

		if (this.focusRootId !== null) this.exitFocus();
		// The pointer stops picking nodes now, so a tooltip left over from the
		// last hover would hang there for the rest of the session.
		this.clearPreviewTimer();
		this.tooltip?.hide();
		this.exploreSession = new ExploreSession(
			this.renderer,
			buildAdjacency(this.model),
			centerId,
			{
				onFocusChanged: (id, neighbors) => {
					this.exploreFocus = { centerId: id, neighbors };
					// Every arrival lands in the trail; back/breadcrumb flights
					// arrive at the already-active crumb, which push() ignores.
					const node = this.model?.nodes[id];
					if (node) this.exploreTrail?.push({ path: node.path, label: node.name });
					this.recomputeVisual();
					this.renderExploreBar();
				},
			},
			// A reduced-motion user gets the same trip with the flight cut out.
			{ flightSeconds: motionSeconds(DEFAULT_EXPLORE_TUNING.flightSeconds) }
		);
		this.cameraWidget?.setExploring(true);
		if (!reanchoring) new Notice(t("notice.exploreStart"), 5000);
	}

	/**
	 * Let go of the current node without leaving the mode: the graph lights
	 * back up and the pointer picks nodes again, so the next leg of the trip
	 * can start anywhere instead of only where the links reach.
	 */
	private detachExplore(): void {
		if (!this.exploreSession) return;
		this.exploreSession.stop();
		this.exploreSession = null;
		this.exploreFocus = null;
		this.exploreDetached = true;
		this.focusBar?.hide();
		this.showExploreTarget(null, 0, 0);
		this.recomputeVisual();
		new Notice(t("notice.exploreDetached"), 5000);
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
		const saved = this.plugin.settings.panel;
		const forced: PanelState = {
			...saved,
			view3d: { ...saved.view3d, enabled: true },
			physics: { ...saved.physics, disabled: true },
		};
		this.applyAllPanelState(forced);
	}

	async exitExplore(): Promise<void> {
		if (!this.exploreSession && !this.exploreDetached) return;
		this.exploreSession?.stop();
		this.exploreSession = null;
		this.exploreFocus = null;
		this.exploreTrail = null;
		this.exploreDetached = false;
		this.focusBar?.hide();
		this.cameraWidget?.setExploring(false);
		this.showExploreTarget(null, 0, 0);

		if (this.exploreOverride) {
			this.exploreOverride = false;
			// The saved settings were never touched, so putting them back is
			// just re-applying them.
			this.applyAllPanelState(this.plugin.settings.panel);
		}
		this.recomputeVisual();

		if (this.rebuildDeferred) {
			this.rebuildDeferred = false;
			await this.rebuildGraph();
		}
	}

	/** Name the note a link leads to, right at the pointer. */
	private showExploreTarget(nodeId: number | null, clientX: number, clientY: number): void {
		if (!this.tooltip || !this.model) return;
		if (nodeId === null) {
			this.tooltipNodeId = null;
			this.tooltip.hide();
			return;
		}
		const rect = this.contentEl.getBoundingClientRect();
		this.tooltip.style.left = `${clientX - rect.left + 14}px`;
		this.tooltip.style.top = `${clientY - rect.top + 14}px`;
		this.tooltip.show();
		if (nodeId === this.tooltipNodeId) return;
		this.tooltipNodeId = nodeId;
		// Just the name: this is a signpost read mid-sweep, not the hover card.
		this.tooltip.empty();
		this.tooltip.createDiv({
			cls: "graph-insight-tooltip-title",
			text: this.model.nodes[nodeId].name,
		});
	}

	/** True for the whole mode, anchored to a node or not. */
	get isExploring(): boolean {
		return this.exploreSession !== null || this.exploreDetached;
	}

	/** Reuses the focus bar to show where the camera is and how to leave. */
	private renderExploreBar(): void {
		if (!this.focusBar || !this.model || !this.exploreFocus) return;
		const { centerId, neighbors } = this.exploreFocus;
		this.focusBar.empty();
		this.focusBar.show();
		this.focusBar.createSpan({
			text: t("explore.status", {
				name: this.model.nodes[centerId].name,
				count: neighbors.length,
			}),
		});
		// With side-pane mode on, the note lands in the companion pane and the
		// graph keeps focus — the trip continues. Otherwise a new tab, so the
		// tab the trip started from is not replaced mid-exploration.
		const open = this.focusBar.createEl("button", { text: t("explore.open") });
		open.setAttribute("aria-label", t("explore.open.hint"));
		open.addEventListener("click", () => this.openNode(centerId, !this.plugin.settings.openInSidePane));
		const back = this.focusBar.createEl("button", { text: t("explore.back") });
		back.addEventListener("click", () => this.exploreBack());
		const detach = this.focusBar.createEl("button", { text: t("explore.detach") });
		detach.setAttribute("aria-label", t("explore.detach.hint"));
		detach.addEventListener("click", () => this.detachExplore());
		const exportButton = this.focusBar.createEl("button", { text: t("topicmap.modalTitle") });
		exportButton.setAttribute("aria-label", t("topicmap.export"));
		exportButton.addEventListener("click", () => {
			if (this.exploreFocus) this.openTopicMapExport("explore", this.exploreFocus.centerId);
		});
		const exit = this.focusBar.createEl("button", { text: t("explore.exit") });
		exit.addEventListener("click", () => void this.exitExplore());
		if (this.exploreTrail && this.exploreTrail.items.length > 1) {
			this.renderTrail(this.focusBar, this.exploreTrail, (id) => this.exploreSession?.travelTo(id));
		}
	}

	private currentFocusDistances(): Int16Array | null {
		if (!this.model || this.focusRootId === null) return null;
		return computeDistances(
			buildAdjacency(this.model),
			this.model.nodes.length,
			this.focusRootId,
			this.focusDepth
		);
	}

	// ── Visual state composition ──────────────────────────────────────

	/** One place that folds search/focus/hidden sets into renderer masks. */
	private recomputeVisual(): void {
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
			for (let i = 0; i < count; i++) {
				const facts = this.facts[i];
				const tagOk =
					pickedTags.size === 0 ||
					facts.tags.some((tag) => pickedTags.has(tag) || [...pickedTags].some((p) => tag.startsWith(`${p}/`)));
				const folderOk =
					pickedFolders.size === 0 ||
					[...pickedFolders].some((f) => facts.folder === f || facts.folder.startsWith(`${f}/`));
				if (!tagOk || !folderOk) hide(i);
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
					softMatched++;
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
	}

	/** Report mode, counts and errors to the search bar. */
	private pushSearchUi(): void {
		const mode: SearchMode = this.softQuery ? "highlight" : this.hardQuery ? "filter" : "idle";
		this.searchBar?.setUiState({
			mode,
			query: this.hardQueryText,
			matchedCount: mode === "highlight" ? this.searchCounts.softMatched : this.searchCounts.visible,
			totalCount: this.searchCounts.total,
			isIndexingContent: this.contentIndexJobs > 0,
			parseError: this.searchParseError,
		});
	}

	/** Scan note bodies for content-search needles not yet indexed. */
	private async ensureContentIndex(needles: string[]): Promise<void> {
		const missing = needles.filter((n) => !this.contentIndex.has(n));
		if (missing.length === 0) return;
		const files = this.app.vault.getMarkdownFiles();
		for (const needle of missing) this.contentIndex.set(needle, new Set());
		// While the scan runs the bar says "Indexing…" instead of a count that
		// would wrongly read as the final (often zero) result.
		this.contentIndexJobs++;
		this.pushSearchUi();
		try {
			for (const file of files) {
				let text: string;
				try {
					text = (await this.app.vault.cachedRead(file)).toLowerCase();
				} catch {
					continue;
				}
				for (const needle of missing) {
					if (text.includes(needle)) this.contentIndex.get(needle)!.add(file.path);
				}
			}
		} finally {
			this.contentIndexJobs--;
		}
		this.recomputeVisual();
	}

	// ── Menus ─────────────────────────────────────────────────────────

	private showNodeMenu(nodeId: number, event: MouseEvent): void {
		if (!this.model) return;
		const node = this.model.nodes[nodeId];
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(t("menu.open")).setIcon("file-text").onClick(() => this.openNode(nodeId, false)));
		menu.addItem((item) => item.setTitle(t("menu.openNewTab")).setIcon("file-plus").onClick(() => this.openNode(nodeId, true)));
		menu.addItem((item) => item.setTitle(t("menu.openRight")).setIcon("separator-vertical").onClick(() => this.openNodeInSplit(nodeId)));
		// Only offered when the core file explorer is actually loaded.
		if (this.fileExplorer()) {
			menu.addItem((item) => item.setTitle(t("menu.reveal")).setIcon("folder-open").onClick(() => this.revealNode(nodeId)));
		}
		menu.addItem((item) => item.setTitle(t("menu.focus")).setIcon("target").onClick(() => this.enterFocus(nodeId)));
		menu.addItem((item) => item.setTitle(t("menu.explore")).setIcon("compass").onClick(() => void this.enterExplore(nodeId)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(t("menu.hide")).setIcon("eye-off").onClick(() => {
			this.hiddenNodes.add(nodeId);
			this.panel?.setHiddenNodeCount(this.hiddenNodes.size);
			this.recomputeVisual();
		}));
		const pinned = this.isPinned(nodeId);
		menu.addItem((item) => item.setTitle(pinned ? t("menu.unpin") : t("menu.pin")).setIcon("pin").onClick(() => {
			this.togglePin(nodeId);
		}));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(t("menu.copyLink")).setIcon("link").onClick(async () => {
			// Write-only: paste-ready Obsidian wikilink for the note.
			await navigator.clipboard.writeText(`[[${node.name}]]`);
			new Notice(t("notice.copiedLink", { name: node.name }));
		}));
		menu.addItem((item) => item.setTitle(t("menu.path", { path: node.path })).setDisabled(true));
		menu.showAtMouseEvent(event);
	}

	private showLassoMenu(nodeIds: number[], event: PointerEvent): void {
		if (!this.model) return;
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(t("menu.selected", { count: nodeIds.length })).setDisabled(true));
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("topicmap.export"))
				.setIcon("map")
				.onClick(() => this.openTopicMapExport("lasso", null, nodeIds))
		);
		menu.addItem((item) => item.setTitle(t("menu.hideSelected")).setIcon("eye-off").onClick(() => {
			for (const id of nodeIds) this.hiddenNodes.add(id);
			this.panel?.setHiddenNodeCount(this.hiddenNodes.size);
			this.recomputeVisual();
		}));
		// One decision for the whole selection: a mixed lasso pins everything,
		// an already-pinned one releases it. Toggling each node separately just
		// swaps which half is pinned.
		const allPinned = nodeIds.every((id) => this.isPinned(id));
		menu.addItem((item) => item
			.setTitle(allPinned ? t("menu.unpinSelected") : t("menu.pinSelected"))
			.setIcon("pin")
			.onClick(() => this.setSelectionPinned(nodeIds, !allPinned)));
		menu.addItem((item) => item.setTitle(t("menu.copyPaths")).setIcon("copy").onClick(async () => {
			// Write-only, and only from this explicit menu action — the plugin
			// never reads the clipboard.
			const paths = nodeIds.map((id) => this.model!.nodes[id].path).join("\n");
			await navigator.clipboard.writeText(paths);
			new Notice(t("notice.copiedPaths", { count: nodeIds.length }));
		}));
		menu.showAtMouseEvent(event);
	}

	private openNode(nodeId: number, newTab: boolean): void {
		const file = this.nodeFile(nodeId);
		if (!file) return;
		// An explicit "new tab" (middle click, menu item) still means a new tab;
		// the side-pane mode only changes what a plain click does.
		if (!newTab && this.plugin.settings.openInSidePane) {
			this.openNodeInSplit(nodeId);
			return;
		}
		this.selfOpenedPath = file.path;
		void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
	}

	/** Open beside the graph, reusing the pane from the previous note. */
	private openNodeInSplit(nodeId: number): void {
		const file = this.nodeFile(nodeId);
		if (!file) return;
		this.selfOpenedPath = file.path;

		const openLeafIds: string[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => openLeafIds.push(leafId(leaf)));
		const action = chooseCompanionAction(this.companionLeafId, openLeafIds, leafId(this.leaf));
		const companion =
			action === "reuse" && this.companionLeafId !== null
				? this.app.workspace.getLeafById(this.companionLeafId)
				: null;
		// Split from the graph's own pane, not the active one — otherwise the
		// new pane lands wherever focus happens to be.
		const target = companion ?? this.app.workspace.createLeafBySplit(this.leaf, "vertical");
		this.companionLeafId = leafId(target);
		// active: false keeps the graph focused — a click is "show me that",
		// not "take me there", and explore mode must not lose the camera.
		void target.openFile(file, { active: false });
	}

	/** Show the note in the file explorer's tree, the way the core graph does. */
	private revealNode(nodeId: number): void {
		const file = this.nodeFile(nodeId);
		const explorer = this.fileExplorer();
		if (!file || !explorer) return;
		void this.app.workspace.revealLeaf(explorer.leaf);
		explorer.view.revealInFolder(file);
	}

	private nodeFile(nodeId: number): TFile | null {
		const path = this.model?.nodes[nodeId]?.path;
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	/** The core file explorer, if it is loaded and still exposes revealInFolder. */
	private fileExplorer(): { leaf: WorkspaceLeaf; view: FileExplorerView } | null {
		for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
			const view = asFileExplorer(leaf.view);
			if (view) return { leaf, view };
		}
		return null;
	}

	/** Panel rows carry the translated name; the stored preset keeps its own. */
	private presetRows(presets: readonly ViewPreset[]): { name: string }[] {
		return presets.map((preset) => ({ name: presetDisplayName(preset) }));
	}

	/** F-09: explicit naming instead of the old first-24-characters auto-name. */
	private savePreset(query: string): void {
		new SearchPresetModal(this.app, t("preset.modal.saveTitle"), { name: "", query }, (draft) => {
			const now = Date.now();
			void this.persistPresets([
				...this.plugin.settings.presets,
				{ id: crypto.randomUUID(), name: draft.name, query: draft.query, createdAt: now, updatedAt: now },
			]).then(() => new Notice(t("notice.filterPresetSaved")));
		}).open();
	}

	/** Save, then hand the freshly sorted list to the bar (and the caller). */
	private async persistPresets(next: SearchPreset[]): Promise<SearchPreset[]> {
		await this.plugin.savePresets(next);
		const sorted = sortSearchPresets(this.plugin.settings.presets);
		this.searchBar?.setPresets(sorted);
		return sorted;
	}

	/** Applying a preset moves it to the top of the recently-used order. */
	private async markPresetUsed(id: string): Promise<void> {
		await this.persistPresets(
			this.plugin.settings.presets.map((preset) =>
				preset.id === id ? { ...preset, lastUsedAt: Date.now() } : preset
			)
		);
	}

	private openPresetManager(): void {
		new SearchPresetManagerModal(this.app, sortSearchPresets(this.plugin.settings.presets), {
			onApply: (preset) => {
				this.searchBar?.applyQuery(preset.query);
				void this.markPresetUsed(preset.id);
			},
			onUpdate: (next) =>
				this.persistPresets(
					this.plugin.settings.presets.map((preset) => (preset.id === next.id ? next : preset))
				),
			onDuplicate: (source) => {
				const now = Date.now();
				return this.persistPresets([
					...this.plugin.settings.presets,
					{
						id: crypto.randomUUID(),
						name: `${source.name}${t("preset.copySuffix")}`,
						query: source.query,
						createdAt: now,
						updatedAt: now,
					},
				]);
			},
			onDelete: (preset) =>
				this.persistPresets(this.plugin.settings.presets.filter((p) => p.id !== preset.id)),
		}).open();
	}

	private async rebuildGraph(): Promise<void> {
		if (!this.renderer || !this.layout) return;
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

		if (this.rebuilding) return;
		if (this.model && sameModelShape(this.model, model)) return;
		this.rebuilding = true;

		const { seed, pinnedPaths } = await this.buildSeedPositions(model);
		// Frame the graph once the very first layout settles; later rebuilds
		// (vault edits) keep whatever framing the user has.
		if (!this.model) this.autoFit.request();
		this.model = model;
		this.facts = this.buildFacts(model, files);
		this.metrics = null;
		this.renderer.setModel(model);
		const view3d = this.plugin.settings.panel.view3d;
		const dims = view3d.enabled && view3d.depthSource === "physics" ? 3 : 2;
		this.layout.start(model, seed, dims);
		this.restorePins(model, seed, pinnedPaths);
		this.apply3D(this.plugin.settings.panel, false);
		this.lastPhysics = "";
		this.applyPhysics(this.plugin.settings.panel);
		// The fresh worker knows nothing about the saved grouping rule, and the
		// node ids behind this.facts have just changed — recompute from scratch.
		this.appliedLayoutRule = null;
		this.applyLayoutRule(this.plugin.settings.panel.layoutRule);
		// F-10: node ids just changed — the old highlight indices are garbage.
		// The data itself is path-based; recompute it if the panel is open.
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
		this.rebuilding = false;
		this.updateEmptyState(model.nodes.length);
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
		if (this.emptyState) return;
		this.emptyState = this.contentEl.createDiv({ cls: "graph-insight-empty" });
		this.emptyState.createDiv({ cls: "graph-insight-empty-title", text: t("empty.title") });
		this.emptyState.createDiv({ cls: "graph-insight-empty-body", text: t("empty.body") });
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
	private async reopen(): Promise<void> {
		await this.onClose();
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
		const palette = activePreset(this.plugin.settings.panel.colorPreset).categories;
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
		model: GraphModel
	): Promise<{ seed: Float32Array | undefined; pinnedPaths: string[] }> {
		const previous = this.renderer?.currentPositions;
		const saved = previous ? null : await this.plugin.dataStore.loadPositions();
		const pinnedPaths = saved
			? saved.pins
			: [...this.explicitPins]
					.map((id) => this.model?.nodes[id]?.path)
					.filter((path): path is string => path !== undefined);
		if (!previous && !saved) return { seed: undefined, pinnedPaths };

		const seed = new Float32Array(model.nodes.length * 3);
		for (const node of model.nodes) {
			let x: number | undefined;
			let y: number | undefined;
			let z = 0;
			if (previous && this.model) {
				const oldId = this.model.pathToId.get(node.path);
				if (oldId !== undefined) {
					x = previous[oldId * 3];
					y = previous[oldId * 3 + 1];
					z = previous[oldId * 3 + 2];
				}
			} else if (saved) {
				const stored = saved.positions[node.path];
				// Older files stored [x, y]; new ones store [x, y, z].
				if (stored) [x, y, z = 0] = stored;
			}
			// Newcomers start near origin with a deterministic spread.
			seed[node.id * 3] = x ?? (node.id % 20) - 10;
			seed[node.id * 3 + 1] = y ?? ((node.id * 7) % 20) - 10;
			seed[node.id * 3 + 2] = z;
		}
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
			};
		});
	}

	private applyEncoding(state: PanelState): void {
		if (!this.renderer || this.facts.length === 0) return;
		const preset = activePreset(state.colorPreset);
		this.renderer.setVisualStyle(preset.glow === true, preset.backdrop ?? null);
		this.encoding = buildEncoding(
			this.facts, state.channels, state.colorPreset, Date.now(), isLightTheme()
		);
		const sizes = new Float32Array(this.encoding.sizes.length);
		for (let i = 0; i < sizes.length; i++) sizes[i] = this.encoding.sizes[i] * state.nodeScale;
		this.renderer.applyEncoding(sizes, this.encoding.tints, this.encoding.glow);
		this.legend?.update(state.channels.color, state.colorPreset, this.encoding.categories);
		this.redrawBubbles();
	}

	private async savePositions(): Promise<void> {
		const positions = this.renderer?.currentPositions;
		if (!positions || !this.model) return;
		const map: PositionMap = {};
		for (const node of this.model.nodes) {
			map[node.path] = [
				Math.round(positions[node.id * 3] * 10) / 10,
				Math.round(positions[node.id * 3 + 1] * 10) / 10,
				Math.round(positions[node.id * 3 + 2] * 10) / 10,
			];
		}
		// Pins travel as paths so they survive the id reshuffle of a rebuild.
		const pins: string[] = [];
		for (const id of this.explicitPins) {
			const path = this.model.nodes[id]?.path;
			if (path) pins.push(path);
		}
		await this.plugin.dataStore.savePositions({ positions: map, pins });
	}

	private showTooltip(nodeId: number | null, clientX: number, clientY: number): void {
		if (!this.tooltip || !this.model) return;
		if (nodeId === null) {
			this.tooltipNodeId = null;
			this.clearPreviewTimer();
			this.tooltip.hide();
			return;
		}
		// The tooltip trails the cursor on every move, but only its position.
		const rect = this.contentEl.getBoundingClientRect();
		this.tooltip.style.left = `${clientX - rect.left + 12}px`;
		this.tooltip.style.top = `${clientY - rect.top + 12}px`;
		// Same node: don't rebuild or re-read — that would cancel the pending
		// preview read on every micro-movement of the mouse.
		if (nodeId === this.tooltipNodeId) return;
		this.tooltipNodeId = nodeId;
		this.clearPreviewTimer();

		const node = this.model.nodes[nodeId];
		const facts = this.facts[nodeId];
		this.tooltip.empty();
		this.tooltip.createDiv({ cls: "graph-insight-tooltip-title", text: node.name });
		if (facts) {
			const meta = this.tooltip.createDiv({ cls: "graph-insight-tooltip-meta" });
			meta.createDiv({
				text: t("tooltip.opens", { total: facts.opensTotal, recent: facts.opens30 }),
			});
			meta.createDiv({
				text: t("tooltip.links", { inbound: facts.inCount, outbound: facts.outCount }),
			});
			meta.createDiv({
				text: t("tooltip.edited", { date: new Date(facts.mtime).toLocaleDateString() }),
			});
		}
		this.tooltip.show();

		const preview = this.plugin.settings.hoverPreview;
		if (preview.enabled) {
			// Only load once the cursor has settled on this node, so sweeping
			// across a dense cluster doesn't fire a read per node.
			this.previewTimer = window.setTimeout(() => {
				this.previewTimer = null;
				if (nodeId === this.tooltipNodeId) void this.appendNotePreview(nodeId, preview.words);
			}, Math.max(0, preview.delayMs));
		}
	}

	private clearPreviewTimer(): void {
		if (this.previewTimer !== null) {
			window.clearTimeout(this.previewTimer);
			this.previewTimer = null;
		}
	}

	/** Read the note body off the main thread and append it to the tooltip,
	 *  unless the hover moved to another node while the read was pending. */
	private async appendNotePreview(nodeId: number, words: number): Promise<void> {
		const text = await this.notePreview(nodeId, words);
		if (nodeId !== this.tooltipNodeId || !this.tooltip || !text) return;
		this.tooltip.createDiv({ cls: "graph-insight-tooltip-preview", text });
	}

	/** First `words` words of the note body (frontmatter stripped). */
	private async notePreview(nodeId: number, words: number): Promise<string | null> {
		const node = this.model?.nodes[nodeId];
		if (!node) return null;
		const file = this.app.vault.getAbstractFileByPath(node.path);
		if (!(file instanceof TFile)) return null;
		let raw = "";
		try {
			raw = await this.app.vault.cachedRead(file);
		} catch {
			return null;
		}
		const body = stripMarkdown(raw.replace(/^---\n[\s\S]*?\n---\n/, ""))
			.replace(/\s+/g, " ")
			.trim();
		if (!body) return null;
		return body.split(" ").slice(0, words).join(" ");
	}

	private handleNodeClick(nodeId: number, event: PointerEvent): void {
		if (!this.model) return;
		// Explore mode let go of its node: the click picks where to carry on
		// from, whatever the cursor tool would normally do.
		if (this.exploreDetached) {
			this.renderer?.setSelected(nodeId);
			void this.enterExplore(nodeId);
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

	async exportPngFile(): Promise<void> {
		const blob = await this.renderer?.exportPng();
		if (!blob) {
			new Notice(t("notice.pngFailed"));
			return;
		}
		downloadBlob("graph-insight.png", blob);
	}

	exportJsonFile(): void {
		if (!this.model) return;
		downloadBlob("graph-insight.json", new Blob([graphToJson(this.model)], { type: "application/json" }));
	}

	exportGexfFile(): void {
		if (!this.model) return;
		downloadBlob("graph-insight.gexf", new Blob([graphToGexf(this.model)], { type: "application/xml" }));
	}

	/** The ONE place panel callbacks are defined — panel is rebuilt from
	 *  here everywhere, so behavior can never diverge between copies. */
	private buildPanel(state: PanelState): ControlPanel {
		return new ControlPanel(this.contentEl, state, {
			onChange: (next) => {
				// A manual tweak diverges from the preset, so it's no longer "applied".
				this.activePresetIndex = null;
				// Any hand-made physics change invalidates the reset's Undo (F-07).
				if (next.physics !== this.plugin.settings.panel.physics) this.physicsUndo = null;
				void this.plugin.savePanelState(next);
				this.applyAllPanelState(next);
			},
			onPhysicsReset: () => void this.resetPhysics(),
			onSectionToggle: (id, open) => {
				if (id === "physics") void this.plugin.saveCollapsedSections({ physics: !open });
			},
			onReheat: () => this.regroup(),
			onClusterClick: (index) => this.zoomToCluster(index),
			onClusterToggle: (index) => this.toggleCluster(index),
			onTrailReplay: () => this.replayTrail(),
			onShowHiddenNodes: () => this.resetHiddenNodes(),
			onResetViewState: () => this.resetViewState(),
			onPresetApply: (index) => void this.applyViewPreset(index),
			onPresetSaveRequest: () => {
				new PromptModal(this.app, t("prompt.presetTitle"), t("prompt.presetDefault"), (name) =>
					void this.saveViewPreset(name)
				).open();
			},
			onPresetDelete: (index) => void this.deleteViewPreset(index),
			onModeChange: (mode) => void this.plugin.savePanelMode(mode),
		}, this.plugin.settings.panelMode, this.plugin.settings.collapsedSections);
	}

	// ── View presets ──────────────────────────────────────────────────

	private async applyViewPreset(index: number): Promise<void> {
		const preset = this.plugin.settings.viewPresets[index];
		if (!preset) return;
		this.activePresetIndex = index;
		// The preset brings its own physics — the reset's Undo no longer applies.
		this.physicsUndo = null;
		this.autoFit.request();
		await this.updatePanelState(() => preset.panel);
		new Notice(t("notice.presetApplied", { name: presetDisplayName(preset) }));
	}

	private async saveViewPreset(name: string): Promise<void> {
		const existing = this.plugin.settings.viewPresets;
		const snapshot = { name, panel: this.plugin.settings.panel };
		// Same name overwrites: saving twice must not pile up duplicates.
		const at = existing.findIndex((p) => p.name === name);
		const next = at >= 0
			? existing.map((p, i) => (i === at ? snapshot : p))
			: [...existing, snapshot];
		await this.plugin.saveViewPresets(next);
		this.panel?.setViewPresets(this.presetRows(next));
		new Notice(
			at >= 0 ? t("notice.presetOverwritten", { name }) : t("notice.presetSaved", { name })
		);
	}

	private async deleteViewPreset(index: number): Promise<void> {
		const existing = this.plugin.settings.viewPresets;
		const preset = existing[index];
		if (!preset) return;
		const next = existing.filter((_, i) => i !== index);
		this.activePresetIndex = null;
		await this.plugin.saveViewPresets(next);
		this.panel?.setViewPresets(this.presetRows(next));
		this.panel?.setSelectedPreset(null);
		new Notice(t("notice.presetDeleted", { name: presetDisplayName(preset) }));
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
		const action = GraphInsightView.TASK_ACTIONS.find((task) => task.id === taskId);
		if (!action) return;
		if (!("presetId" in action)) {
			// «Исследовать тему»: turn on the Links tool, keep every filter.
			this.toolBar?.selectTool("links");
			return;
		}
		void this.runTaskPreset(action.presetId, action.diagnostic);
	}

	private async runTaskPreset(builtinId: BuiltinPresetId, diagnostic: boolean): Promise<void> {
		const ensured = ensureBuiltinPreset(this.plugin.settings.viewPresets, builtinId);
		if (!ensured) return;
		if (ensured.presets !== this.plugin.settings.viewPresets) {
			// The user hand-deleted the bundled preset — restore it first.
			await this.plugin.saveViewPresets([...ensured.presets]);
			this.panel?.setViewPresets(this.presetRows(this.plugin.settings.viewPresets));
		}
		if (diagnostic) this.clearHardQueryForTask();
		await this.applyViewPreset(ensured.index);
	}

	/** Diagnostic tasks need the whole vault visible: drop the hard query but
	 *  keep it one click away until the next view-state change. */
	private clearHardQueryForTask(): void {
		if (!this.hardQueryText) return;
		const cleared = this.hardQueryText;
		this.taskQueryUndo = cleared;
		this.hardQuery = null;
		this.hardQueryText = "";
		this.searchParseError = undefined;
		this.recomputeVisual();

		const fragment = document.createDocumentFragment();
		fragment.append(t("notice.queryCleared", { query: cleared }));
		const undo = document.createElement("button");
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
		const menu = new Menu();
		for (const action of GraphInsightView.TASK_ACTIONS) {
			menu.addItem((item) => item.setTitle(t(action.labelKey)).onClick(() => this.runTask(action.id)));
		}
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
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
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("tool.follow"))
				.setIcon("locate-fixed")
				.setChecked(this.plugin.settings.followActiveNote)
				.onClick(() => void this.plugin.setFollowActiveNote(!this.plugin.settings.followActiveNote))
		);
		menu.addItem((item) =>
			item
				.setTitle(t("tool.sidePane"))
				.setIcon("panel-right")
				.setChecked(this.plugin.settings.openInSidePane)
				.onClick(() => void this.plugin.setOpenInSidePane(!this.plugin.settings.openInSidePane))
		);
		menu.addItem((item) =>
			item
				.setTitle(t("tool.localGraph"))
				.setIcon("orbit")
				.onClick(() => void this.plugin.activateLocalGraph())
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(t("camera.fit")).setIcon("maximize").onClick(() => this.renderer?.fitAll())
		);
		menu.addItem((item) =>
			item.setTitle(t("camera.reset")).setIcon("rotate-ccw").onClick(() => this.renderer?.resetCamera())
		);
		menu.addItem((item) =>
			item
				.setTitle(t("camera.explore"))
				.setIcon("compass")
				.setChecked(this.isExploring)
				.onClick(() => void (this.exploreSession ? this.exitExplore() : this.enterExplore()))
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(t("preset.manage")).setIcon("list").onClick(() => this.openPresetManager())
		);
		menu.addItem((item) =>
			item.setTitle(t("changes.open")).setIcon("history").onClick(() => this.toggleChangesPanel())
		);
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
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

		const fragment = document.createDocumentFragment();
		fragment.append(t("notice.physicsReset", { diff: formatPhysicsDiff(diff) }));
		const undo = document.createElement("button");
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
	private applyAllPanelState(state: PanelState): void {
		this.applyEncoding(state);
		this.applyOverlays(state);
		this.redrawBubbles();
		this.syncTimelineAndTrail(state);
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
		);
	}

	/** One button to undo every temporary visual state. */
	private resetViewState(): void {
		this.hiddenNodes.clear();
		this.hiddenClusters.clear();
		this.softQuery = null;
		this.hardQuery = null;
		this.hardQueryText = "";
		this.searchParseError = undefined;
		this.pathAnchor = null;
		this.toolBar?.setPathStage("start");
		this.focusRootId = null;
		this.focusBar?.hide();
		this.chipFilter = { tags: new Set(), folders: new Set() };
		this.filterChips?.setSelection(this.chipFilter);
		void this.plugin.saveChipFilter({ tags: [], folders: [] });
		this.searchBar?.clear();
		this.renderer?.setSelected(null);
		this.renderer?.setHighlightMask(null);
		this.renderer?.setAlphaFactors(null);
		this.renderer?.setPathHighlight(null);
		this.pathDrawn = false;
		this.panel?.setHiddenNodeCount(0);
		this.recomputeVisual();
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
		if (this.trailReplayFrame !== null) window.cancelAnimationFrame(this.trailReplayFrame);
		const durationMs = motionMs(TRAIL_REPLAY_MS);
		const start = performance.now();
		const step = () => {
			const progress = Math.min(1, (performance.now() - start) / durationMs);
			this.drawTrail(progress);
			if (progress < 1) this.trailReplayFrame = window.requestAnimationFrame(step);
			else this.trailReplayFrame = null;
		};
		this.trailReplayFrame = window.requestAnimationFrame(step);
	}

	onResize(): void {
		this.renderer?.resize();
	}

	async onClose(): Promise<void> {
		// Forget the companion pane without closing it: the note in it is the
		// user's, and they may well still be reading it.
		this.companionLeafId = null;
		this.clearPreviewTimer();
		this.exploreSession?.stop();
		this.exploreSession = null;
		this.exploreDetached = false;
		this.exploreOverride = false;
		await this.savePositions();
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
		if (this.trailReplayFrame !== null) window.cancelAnimationFrame(this.trailReplayFrame);
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
	}
}

/** The core file explorer reveals a file through `revealInFolder`, which is not
 *  part of the public typings. Probed for at runtime rather than assumed: a
 *  future Obsidian may drop it, and a missing menu item beats a crash. */
interface FileExplorerView extends View {
	revealInFolder(file: TAbstractFile): void;
}

function asFileExplorer(view: View): FileExplorerView | null {
	const candidate = view as Partial<FileExplorerView>;
	return typeof candidate.revealInFolder === "function" ? (view as FileExplorerView) : null;
}

/** Leaf ids exist at runtime (getLeafById is public API) but are missing from
 *  the typings. An id-less leaf yields "" — it matches nothing, so the worst
 *  case is one extra split, never a crash. */
function leafId(leaf: WorkspaceLeaf): string {
	const id = (leaf as WorkspaceLeaf & { id?: unknown }).id;
	return typeof id === "string" ? id : "";
}

function downloadBlob(fileName: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const anchor = createEl("a", { attr: { href: url, download: fileName } });
	anchor.click();
	URL.revokeObjectURL(url);
}

/** Cheap structural equality: counts + every node path. */
function sameModelShape(a: GraphModel, b: GraphModel): boolean {
	if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
	for (let i = 0; i < a.nodes.length; i++) {
		if (a.nodes[i].path !== b.nodes[i].path) return false;
	}
	return true;
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

