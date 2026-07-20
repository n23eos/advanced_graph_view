import { ItemView, Keymap, Menu, Notice, TFile, debounce, getAllTags, type WorkspaceLeaf } from "obsidian";
import { buildAdjacency, computeDistances, shortestPath } from "../analysis/focus";
import { nameClusters, type ClusterContent } from "../analysis/clusterNames";
import { computeOverlayMask, countOverlayMatches } from "../analysis/overlays";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { countRecentOpens } from "../data/UsageTracker";
import type { PositionMap } from "../data/persistence";
import { buildEncoding, type NodeEncoding } from "../encoding/encode";
import { categoryColor } from "../encoding/colorScales";
import type { NodeFacts } from "../encoding/metrics";
import { GraphRenderer } from "../render/GraphRenderer";
import { ControlPanel, type PanelState } from "../ui/ControlPanel";
import { Legend } from "../ui/Legend";
import { LayoutClient } from "../workers/LayoutClient";
import { MetricsClient, type GraphMetrics } from "../workers/MetricsClient";
import { contentNeedles, parseQuery, matchesQuery, type ParsedQuery } from "../query/QueryParser";
import { SearchBar } from "../ui/SearchBar";
import { FilterChips, type FilterSelection } from "../ui/FilterChips";
import { SemanticConsentModal } from "../ui/ConsentModal";
import { OnboardingModal } from "../ui/OnboardingModal";
import { PromptModal } from "../ui/PromptModal";
import { TimelineBar, type TimelineMode } from "../ui/TimelineBar";
import { CameraWidget } from "../ui/CameraWidget";
import { ToolBar, type CursorTool } from "../ui/ToolBar";
import { graphToGexf, graphToJson } from "../export/exporters";
import type GraphInsightPlugin from "../main";
import type { SemanticSettings } from "../main";
import type { SemanticPair, SemanticStatus } from "../semantic/SemanticService";

export const GRAPH_INSIGHT_VIEW_TYPE = "graph-insight-view";

const POSITION_SAVE_DEBOUNCE_MS = 5000;

export class GraphInsightView extends ItemView {
	private renderer: GraphRenderer | null = null;
	private layout: LayoutClient | null = null;
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
	private tooltip: HTMLElement | null = null;
	private panel: ControlPanel | null = null;
	/** needle → set of matching paths, built lazily on Enter. */
	private contentIndex = new Map<string, Set<string>>();
	private legend: Legend | null = null;
	private searchBar: SearchBar | null = null;
	private filterChips: FilterChips | null = null;
	/** Tag/folder picks from the dedicated dropdowns (OR inside, AND across). */
	private chipFilter: FilterSelection = { tags: new Set(), folders: new Set() };
	private focusBar: HTMLElement | null = null;
	private toolBar: ToolBar | null = null;
	private semanticChip: HTMLElement | null = null;
	private cursorTool: CursorTool = "open";
	/** First endpoint picked in «Путь» mode. */
	private pathAnchor: number | null = null;

	/** Live (soft) query while typing; matched=1, others dimmed. */
	private softQuery: ParsedQuery | null = null;
	/** Committed (Enter) query: non-matches are hidden entirely. */
	private hardQuery: ParsedQuery | null = null;
	private focusRootId: number | null = null;
	private focusDepth = 2;
	private timeline: TimelineBar | null = null;
	private cameraWidget: CameraWidget | null = null;
	private timelineCutoff: number | null = null;
	private timelineMode: TimelineMode = "created";
	private trailReplayFrame: number | null = null;

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
		return "Graph Insight";
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

		this.renderer = new GraphRenderer({
			onNodeHover: (nodeId, clientX, clientY) => this.showTooltip(nodeId, clientX, clientY),
			onNodeClick: (nodeId, event) => this.handleNodeClick(nodeId, event),
			onNodeDoubleClick: (nodeId) => this.enterFocus(nodeId),
			onNodeContextMenu: (nodeId, event) => this.showNodeMenu(nodeId, event),
			onLassoSelect: (nodeIds, event) => this.showLassoMenu(nodeIds, event),
			onSemanticEdgeClick: (pairIndex, event) => this.showSemanticEdgeMenu(pairIndex, event),
			onNodeDragStart: (nodeId) => {
				const positions = this.renderer?.currentPositions;
				if (positions) {
					this.layout?.pin(
						nodeId,
						positions[nodeId * 3], positions[nodeId * 3 + 1], positions[nodeId * 3 + 2]
					);
				}
				this.layout?.dragStart();
			},
			onNodeDrag: (nodeId, x, y, z) => this.layout?.pin(nodeId, x, y, z),
			onNodeDragEnd: (nodeId) => {
				// Released node keeps its spot (temporary fixation) — otherwise
				// the warm simulation immediately drags it back to its links,
				// which feels like the node is glued in place. Context menu →
				// «Открепить» releases it.
				this.pinnedNodes.add(nodeId);
				this.layout?.dragEnd();
				this.savePositionsDebounced();
			},
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
			}
		);

		this.metricsClient = new MetricsClient((metrics) => this.handleMetricsResult(metrics));

		this.panel = this.buildPanel(this.plugin.settings.panel);
		this.panel.setViewPresets(this.plugin.settings.viewPresets);
		this.registerSemanticStatus();
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
				onOffsetChange: (x, y) => this.renderer?.setViewCenterOffset(x, y),
				onFit: () => this.renderer?.fitAll(),
				onToggleUI: (hidden) => this.contentEl.toggleClass("graph-insight-ui-hidden", hidden),
			}
		);

		this.searchBar = new SearchBar(container, {
			onQueryChange: (query) => {
				this.softQuery = query.trim() ? parseQuery(query) : null;
				this.recomputeVisual();
			},
			onCommit: (query) => {
				this.hardQuery = query.trim() ? parseQuery(query) : null;
				this.softQuery = null;
				this.recomputeVisual();
				// content:/слово: terms need note text — build the index
				// asynchronously, then re-filter.
				if (this.hardQuery) void this.ensureContentIndex(contentNeedles(this.hardQuery));
			},
			onClear: () => {
				this.softQuery = null;
				this.hardQuery = null;
				this.recomputeVisual();
			},
			onSavePreset: (query) => void this.savePreset(query),
		});
		this.searchBar.setPresets(this.plugin.settings.presets);
		this.filterChips = new FilterChips(this.searchBar.filtersHost, {
			onChange: (selection) => {
				this.chipFilter = selection;
				this.recomputeVisual();
			},
		});

		this.toolBar = new ToolBar(container, this.cursorTool, this.focusDepth, {
			onToolChange: (tool) => {
				this.cursorTool = tool;
				this.pathAnchor = null;
				if (tool !== "links" && this.focusRootId !== null) this.exitFocus();
			},
			onDepthChange: (depth) => {
				this.focusDepth = depth;
				if (this.focusRootId !== null) {
					this.renderFocusBar();
					this.recomputeVisual();
				}
			},
		});

		this.semanticChip = container.createDiv({ cls: "graph-insight-semantic-chip" });
		this.semanticChip.hide();

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

		this.registerDomEvent(document, "keydown", (event) => {
			if (event.key === "Escape" && this.focusRootId !== null) this.exitFocus();
		});

		await this.rebuildGraph();

		this.registerEvent(this.app.metadataCache.on("resolved", () => this.rebuildDebounced()));

		if (!this.plugin.settings.onboardingShown) {
			new OnboardingModal(this.app, () => void this.plugin.markOnboardingShown()).open();
		}
	}

	/** Re-read plugin settings (used by commands that mutate them). */
	refreshFromSettings(): void {
		this.refreshSemanticEdges();
	}

	// ── Semantics ─────────────────────────────────────────────────────

	/** Semantic pairs currently drawn, parallel to renderer pair indexes. */
	private shownSemanticPairs: SemanticPair[] = [];
	private semanticUnsubscribe: (() => void) | null = null;

	private registerSemanticStatus(): void {
		this.semanticUnsubscribe = this.plugin.semantics.onStatus((status) => {
			const text = this.formatSemanticStatus(status);
			this.panel?.setSemanticStatus(text);
			// A visible chip: model download and indexing take minutes, and
			// the panel section is usually collapsed.
			if (this.semanticChip) {
				const busy = status.state !== "off" && status.state !== "ready";
				this.semanticChip.setText(`Semantics · ${text}`);
				this.semanticChip.toggleClass("is-error", status.state === "error");
				if (busy || status.state === "error") this.semanticChip.show();
				else this.semanticChip.hide();
			}
			if (status.state === "ready") this.refreshSemanticEdges();
		});
	}

	private formatSemanticStatus(status: SemanticStatus): string {
		switch (status.state) {
			case "off": return "Off";
			case "loading-model": {
				const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
				return status.total > 0
					? `Downloading model: ${mb(status.done)} / ${mb(status.total)} MB`
					: "Downloading model…";
			}
			case "indexing": return `Indexing: ${status.done} / ${status.total}`;
			case "pairing": return `Finding pairs: ${status.done} / ${status.total}`;
			case "ready":
				return status.done > 0
					? `Ready · ${status.done} notes indexed`
					: "Ready · index is empty";
			case "error": return `Error: ${status.message ?? "?"}`;
		}
	}

	private handleSemanticSettings(settings: SemanticSettings): void {
		const previous = this.plugin.settings.semantics;
		const wasEnabled = previous.enabled;
		// Consent is asked once ever; after that enabling is a plain toggle
		// (the model is already cached locally).
		if (settings.enabled && !wasEnabled && !previous.consentGiven) {
			new SemanticConsentModal(this.app, () => {
				void this.plugin.saveSemanticSettings({ ...settings, consentGiven: true });
				void this.plugin.semantics.enable();
			}).open();
			return;
		}
		void this.plugin.saveSemanticSettings(settings);
		if (settings.enabled && !wasEnabled) void this.plugin.semantics.enable();
		if (!settings.enabled && wasEnabled) {
			this.plugin.semantics.disable();
			this.renderer?.setSemanticEdges(null);
			this.shownSemanticPairs = [];
			return;
		}
		this.refreshSemanticEdges();
	}

	/** Filter service pairs by threshold, drop explicitly linked ones, draw. */
	private refreshSemanticEdges(): void {
		if (!this.renderer || !this.model) return;
		const settings = this.plugin.settings.semantics;
		if (!settings.enabled || !settings.showEdges) {
			this.renderer.setSemanticEdges(null);
			this.shownSemanticPairs = [];
			return;
		}

		const linked = new Set<string>();
		for (const edge of this.model.edges) {
			linked.add(`${Math.min(edge.source, edge.target)}|${Math.max(edge.source, edge.target)}`);
		}

		const drawn: { a: number; b: number }[] = [];
		this.shownSemanticPairs = [];
		for (const pair of this.plugin.semantics.getPairs()) {
			if (pair.similarity < settings.threshold) break; // pairs are sorted desc
			const a = this.model.pathToId.get(pair.pathA);
			const b = this.model.pathToId.get(pair.pathB);
			if (a === undefined || b === undefined) continue;
			if (linked.has(`${Math.min(a, b)}|${Math.max(a, b)}`)) continue;
			drawn.push({ a, b });
			this.shownSemanticPairs.push(pair);
		}
		this.renderer.setSemanticEdges(drawn);
		const total = this.plugin.semantics.getPairs().length;
		if (total > 0) {
			this.panel?.setSemanticStatus(
				`Showing ${drawn.length} dashed links out of ${total} similar pairs`
			);
		}
	}

	private showSemanticEdgeMenu(pairIndex: number, event: MouseEvent): void {
		const pair = this.shownSemanticPairs[pairIndex];
		if (!pair || !this.model) return;
		const nameA = basename(pair.pathA);
		const nameB = basename(pair.pathB);
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle(`Similarity ${(pair.similarity * 100).toFixed(0)}%: ${nameA} ↔ ${nameB}`).setDisabled(true)
		);
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(`Create link in "${nameA}"`).setIcon("link").onClick(
			() => void this.insertWikilink(pair.pathA, pair.pathB)
		));
		menu.addItem((item) => item.setTitle(`Create link in "${nameB}"`).setIcon("link").onClick(
			() => void this.insertWikilink(pair.pathB, pair.pathA)
		));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(`Open "${nameA}"`).onClick(() => this.openPath(pair.pathA)));
		menu.addItem((item) => item.setTitle(`Open "${nameB}"`).onClick(() => this.openPath(pair.pathB)));
		menu.showAtMouseEvent(event);
	}

	/** Explicit user action from the semantic-edge popup — the only place
	 *  the plugin ever modifies a note. */
	private async insertWikilink(intoPath: string, targetPath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(intoPath);
		if (!(file instanceof TFile)) return;
		const target = this.app.vault.getAbstractFileByPath(targetPath);
		if (!(target instanceof TFile)) return;
		const link = this.app.metadataCache.fileToLinktext(target, intoPath);
		await this.app.vault.process(file, (content) => {
			const relatedHeader = /^##\s+Related\s*$/m.exec(content);
			if (relatedHeader) {
				const insertAt = relatedHeader.index + relatedHeader[0].length;
				return `${content.slice(0, insertAt)}\n[[${link}]]${content.slice(insertAt)}`;
			}
			return `${content.trimEnd()}\n\n[[${link}]]\n`;
		});
		new Notice(`Link [[${link}]] added to ${basename(intoPath)}`);
	}

	private openPath(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
	}

	private async showSimilarMenu(nodeId: number, event: MouseEvent): Promise<void> {
		if (!this.model) return;
		const path = this.model.nodes[nodeId].path;
		const { paths, sims } = await this.plugin.semantics.similar(path, 10);
		const menu = new Menu();
		if (paths.length === 0) {
			menu.addItem((item) => item.setTitle("Index is not ready yet").setDisabled(true));
		}
		paths.forEach((similarPath, i) => {
			menu.addItem((item) =>
				item.setTitle(`${(sims[i] * 100).toFixed(0)}% · ${basename(similarPath)}`).onClick(
					() => this.openPath(similarPath)
				)
			);
		});
		menu.showAtPosition({ x: event.clientX, y: event.clientY });
	}

	/** «Путь»: first click sets the anchor, second highlights the chain. */
	private handlePathPick(nodeId: number): void {
		if (!this.model) return;
		if (this.pathAnchor === null || this.pathAnchor === nodeId) {
			this.pathAnchor = nodeId;
			new Notice(`Start: ${this.model.nodes[nodeId].name}. Click the second note.`);
			return;
		}
		const path = shortestPath(
			buildAdjacency(this.model),
			this.model.nodes.length,
			this.pathAnchor,
			nodeId
		);
		this.pathAnchor = null;
		if (path.length === 0) {
			new Notice("No link path between these notes");
			this.renderer?.setAlphaFactors(null);
			this.renderer?.setHighlightMask(null);
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
		this.renderer?.zoomToNodes(path);
		const names = path.map((id) => this.model!.nodes[id].name);
		new Notice(`Path of ${path.length} notes: ${names.join(" → ")}`, 8000);
	}

	// ── Focus mode ────────────────────────────────────────────────────

	private enterFocus(nodeId: number): void {
		this.focusRootId = nodeId;
		this.renderFocusBar();
		this.recomputeVisual();
	}

	private exitFocus(): void {
		this.focusRootId = null;
		this.focusBar?.hide();
		this.recomputeVisual();
	}

	private renderFocusBar(): void {
		if (!this.focusBar || !this.model || this.focusRootId === null) return;
		const distances = this.currentFocusDistances();
		const visible = distances ? distances.filter((d) => d >= 0).length : 0;
		this.focusBar.empty();
		this.focusBar.show();
		this.focusBar.createSpan({
			text: `Focus: ${this.model.nodes[this.focusRootId].name} · depth ${this.focusDepth} · ${visible} nodes`,
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
		const exit = this.focusBar.createEl("button", { text: "Esc" });
		exit.addEventListener("click", () => this.exitFocus());
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

		let hidden: Uint8Array | null = null;
		const ensureHidden = () => (hidden ??= new Uint8Array(count));
		if (this.hardQuery) {
			for (let i = 0; i < count; i++) {
				if (!matchesQuery(this.hardQuery, this.facts[i], now, contentMatcher)) ensureHidden()[i] = 1;
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
				if (!tagOk || !folderOk) ensureHidden()[i] = 1;
			}
		}
		if (this.hiddenClusters.size > 0 && this.metrics) {
			for (let i = 0; i < count; i++) {
				if (this.hiddenClusters.has(this.metrics.community[i])) ensureHidden()[i] = 1;
			}
		}
		if (this.timelineCutoff !== null) {
			for (let i = 0; i < count; i++) {
				const ts = this.timelineMode === "created" ? this.facts[i].ctime : this.facts[i].mtime;
				if (ts >= this.timelineCutoff) ensureHidden()[i] = 1;
			}
		}
		for (const id of this.hiddenNodes) ensureHidden()[id] = 1;
		this.renderer.setHiddenMask(hidden);

		let factors: Float32Array | null = null;
		let highlight: Uint8Array | null = null;
		if (this.softQuery) {
			factors = new Float32Array(count);
			highlight = new Uint8Array(count);
			for (let i = 0; i < count; i++) {
				const matched = matchesQuery(this.softQuery, this.facts[i], now, contentMatcher);
				factors[i] = matched ? 1 : 0.12;
				if (matched) highlight[i] = 1;
			}
		}
		// Active overlays glow with the accent color, same as search hits.
		if (this.overlayMask) {
			highlight ??= new Uint8Array(count);
			for (let i = 0; i < count; i++) {
				if (this.overlayMask[i] === 1) highlight[i] = 1;
			}
		}
		this.renderer.setHighlightMask(highlight);
		const distances = this.currentFocusDistances();
		if (distances) {
			factors ??= new Float32Array(count).fill(1);
			const falloff = [1, 0.6, 0.35, 0.2];
			for (let i = 0; i < count; i++) {
				const d = distances[i];
				factors[i] *= d >= 0 ? falloff[Math.min(d, falloff.length - 1)] : 0.04;
			}
		}
		this.renderer.setAlphaFactors(factors);
	}

	/** Scan note bodies for content-search needles not yet indexed. */
	private async ensureContentIndex(needles: string[]): Promise<void> {
		const missing = needles.filter((n) => !this.contentIndex.has(n));
		if (missing.length === 0) return;
		const files = this.app.vault.getMarkdownFiles();
		for (const needle of missing) this.contentIndex.set(needle, new Set());
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
		this.recomputeVisual();
	}

	// ── Menus ─────────────────────────────────────────────────────────

	private showNodeMenu(nodeId: number, event: MouseEvent): void {
		if (!this.model) return;
		const node = this.model.nodes[nodeId];
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Open").setIcon("file-text").onClick(() => this.openNode(nodeId, false)));
		menu.addItem((item) => item.setTitle("Open in new tab").setIcon("file-plus").onClick(() => this.openNode(nodeId, true)));
		menu.addItem((item) => item.setTitle("Focus mode").setIcon("target").onClick(() => this.enterFocus(nodeId)));
		if (this.plugin.settings.semantics.enabled) {
			menu.addItem((item) => item.setTitle("Show similar").setIcon("search").onClick(
				() => void this.showSimilarMenu(nodeId, event)
			));
		}
		menu.addSeparator();
		menu.addItem((item) => item.setTitle("Hide node").setIcon("eye-off").onClick(() => {
			this.hiddenNodes.add(nodeId);
			this.panel?.setHiddenNodeCount(this.hiddenNodes.size);
			this.recomputeVisual();
		}));
		const pinned = this.explicitPins.has(nodeId) || this.pinnedNodes.has(nodeId);
		menu.addItem((item) => item.setTitle(pinned ? "Unpin" : "Pin position").setIcon("pin").onClick(() => {
			if (pinned) {
				this.pinnedNodes.delete(nodeId);
				this.explicitPins.delete(nodeId);
				this.layout?.unpin(nodeId);
			} else {
				const positions = this.renderer?.currentPositions;
				if (positions) {
					this.explicitPins.add(nodeId);
					this.layout?.pin(
						nodeId,
						positions[nodeId * 3], positions[nodeId * 3 + 1], positions[nodeId * 3 + 2]
					);
				}
			}
		}));
		menu.addItem((item) => item.setTitle(`Path: ${node.path}`).setDisabled(true));
		menu.showAtMouseEvent(event);
	}

	private showLassoMenu(nodeIds: number[], event: PointerEvent): void {
		if (!this.model) return;
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(`Selected: ${nodeIds.length} notes`).setDisabled(true));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle("Hide selected").setIcon("eye-off").onClick(() => {
			for (const id of nodeIds) this.hiddenNodes.add(id);
			this.panel?.setHiddenNodeCount(this.hiddenNodes.size);
			this.recomputeVisual();
		}));
		menu.addItem((item) => item.setTitle("Copy paths to clipboard").setIcon("copy").onClick(async () => {
			// Write-only, and only from this explicit menu action — the plugin
			// never reads the clipboard.
			const paths = nodeIds.map((id) => this.model!.nodes[id].path).join("\n");
			await navigator.clipboard.writeText(paths);
			new Notice(`Copied ${nodeIds.length} paths`);
		}));
		menu.showAtMouseEvent(event);
	}

	private openNode(nodeId: number, newTab: boolean): void {
		if (!this.model) return;
		const file = this.app.vault.getAbstractFileByPath(this.model.nodes[nodeId].path);
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
		}
	}

	private async savePreset(query: string): Promise<void> {
		const name = query.length > 24 ? `${query.slice(0, 24)}…` : query;
		await this.plugin.savePresets([...this.plugin.settings.presets, { name, query }]);
		this.searchBar?.setPresets(this.plugin.settings.presets);
		new Notice("Filter preset saved");
	}

	private async rebuildGraph(): Promise<void> {
		if (!this.renderer || !this.layout) return;
		const files = this.app.vault.getMarkdownFiles();
		const cache = this.app.metadataCache;
		const model = buildGraphModel(files.map((f) => f.path), cache.resolvedLinks, cache.unresolvedLinks);

		if (this.rebuilding) return;
		if (this.model && sameModelShape(this.model, model)) return;
		this.rebuilding = true;

		const seed = await this.buildSeedPositions(model);
		this.model = model;
		this.facts = this.buildFacts(model, files);
		this.metrics = null;
		this.renderer.setModel(model);
		const view3d = this.plugin.settings.panel.view3d;
		const dims = view3d.enabled && view3d.depthSource === "physics" ? 3 : 2;
		this.layout.start(model, seed, dims);
		this.apply3D(this.plugin.settings.panel, false);
		this.lastPhysics = "";
		this.applyPhysics(this.plugin.settings.panel);
		const panelState = this.plugin.settings.panel;
		this.renderer.setLabelOptions(
			panelState.labels.fontSize, panelState.labels.zoomThreshold,
			panelState.labels.maxCount, panelState.labels.scaleWithZoom
		);
		this.renderer.setEdgeStyle(panelState.edges.show, panelState.edges.width, panelState.edges.opacity);
		this.applyEncoding(this.plugin.settings.panel);
		this.applyOverlays(this.plugin.settings.panel);
		this.panel?.setOverlayCounts(countOverlayMatches(model));
		this.metricsClient?.compute(model);
		this.refreshSemanticEdges();
		this.refreshTimelineData();
		this.syncTimelineAndTrail(this.plugin.settings.panel);
		const vocabulary = collectVocabulary(this.facts);
		this.searchBar?.setVocabulary(...vocabulary);
		this.filterChips?.setVocabulary(...vocabulary);
		this.rebuilding = false;
	}

	/** Worker finished PageRank + Louvain: enrich facts, refresh UI. */
	private handleMetricsResult(metrics: GraphMetrics): void {
		if (!this.model || this.facts.length !== metrics.pagerank.length) return;
		this.metrics = metrics;

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

	private applyOverlays(state: PanelState): void {
		if (!this.model || !this.renderer) return;
		this.overlayMask = computeOverlayMask(this.model, state.overlays);
		this.renderer.setDimMask(this.overlayMask);
		// Matches must also LIGHT UP, not merely survive the dimming.
		this.recomputeVisual();

		if (this.overlayMask) {
			let matched = 0;
			for (const flag of this.overlayMask) matched += flag;
			const names: string[] = [];
			if (state.overlays.orphans) names.push("orphans");
			if (state.overlays.deadEnds) names.push("dead ends");
			if (state.overlays.broken) names.push("broken links");
			new Notice(`Highlighted ${matched} notes: ${names.join(", ")}`);
		}
	}

	private redrawBubbles(): void {
		if (!this.renderer) return;
		if (!this.plugin.settings.panel.showBubbles || !this.metrics) {
			this.renderer.drawClusterHulls(null);
			return;
		}
		const groups = this.clusterOrder
			.filter((communityId) => !this.hiddenClusters.has(communityId))
			.map((communityId) => ({
				nodeIds: this.clusterNodeIds(communityId),
				color: categoryColor(this.clusterNames[communityId] ?? String(communityId)),
			}));
		this.renderer.drawClusterHulls(groups);
	}

	/** Prefer live coordinates from the previous model, else saved positions. */
	private async buildSeedPositions(model: GraphModel): Promise<Float32Array | undefined> {
		const previous = this.renderer?.currentPositions;
		const saved = previous ? null : await this.plugin.dataStore.loadPositions();
		if (!previous && !saved) return undefined;

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
				const stored = saved[node.path];
				// Older files stored [x, y]; new ones store [x, y, z].
				if (stored) [x, y, z = 0] = stored;
			}
			// Newcomers start near origin with a deterministic spread.
			seed[node.id * 3] = x ?? (node.id % 20) - 10;
			seed[node.id * 3 + 1] = y ?? ((node.id * 7) % 20) - 10;
			seed[node.id * 3 + 2] = z;
		}
		return seed;
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
		const tuning = state.colorTuning;
		const customStops = tuning.useCustom
			? [parseInt(tuning.customFrom.slice(1), 16), parseInt(tuning.customTo.slice(1), 16)]
			: null;
		this.encoding = buildEncoding(
			this.facts,
			state.channels,
			tuning.useCustom ? state.colorPreset : tuning.preset,
			Date.now(),
			{ gamma: tuning.gamma, customStops }
		);
		const sizes = new Float32Array(this.encoding.sizes.length);
		for (let i = 0; i < sizes.length; i++) sizes[i] = this.encoding.sizes[i] * state.nodeScale;
		this.renderer.applyEncoding(sizes, this.encoding.tints, this.encoding.glow);
		this.legend?.update(
			state.channels.color,
			tuning.useCustom ? state.colorPreset : tuning.preset,
			this.encoding.categories,
			customStops
		);
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
		await this.plugin.dataStore.savePositions(map);
	}

	private showTooltip(nodeId: number | null, clientX: number, clientY: number): void {
		if (!this.tooltip || !this.model) return;
		if (nodeId === null) {
			this.tooltip.hide();
			return;
		}
		const node = this.model.nodes[nodeId];
		const facts = this.facts[nodeId];
		this.tooltip.empty();
		this.tooltip.createDiv({ cls: "graph-insight-tooltip-title", text: node.name });
		if (facts) {
			const meta = this.tooltip.createDiv({ cls: "graph-insight-tooltip-meta" });
			meta.createDiv({ text: `Opens: ${facts.opensTotal} (30d: ${facts.opens30})` });
			meta.createDiv({ text: `Links: ← ${facts.inCount} · → ${facts.outCount}` });
			meta.createDiv({ text: `Edited: ${new Date(facts.mtime).toLocaleDateString()}` });
		}
		const rect = this.contentEl.getBoundingClientRect();
		this.tooltip.style.left = `${clientX - rect.left + 12}px`;
		this.tooltip.style.top = `${clientY - rect.top + 12}px`;
		this.tooltip.show();
	}

	private handleNodeClick(nodeId: number, event: PointerEvent): void {
		if (!this.model) return;
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
				if (this.explicitPins.has(nodeId)) {
					this.explicitPins.delete(nodeId);
					this.pinnedNodes.delete(nodeId);
					this.layout?.unpin(nodeId);
					new Notice(`Unpinned: ${node.name}`);
				} else {
					const positions = this.renderer?.currentPositions;
					if (positions) {
						this.explicitPins.add(nodeId);
						this.layout?.pin(
							nodeId,
							positions[nodeId * 3], positions[nodeId * 3 + 1], positions[nodeId * 3 + 2]
						);
						new Notice(`Pinned: ${node.name}`);
					}
				}
				return;
			}
			case "open":
				break;
		}
		const file = this.app.vault.getAbstractFileByPath(node.path);
		if (!(file instanceof TFile)) return;
		// Plain click opens in the last used pane; Cmd = new tab, Cmd+Shift = split.
		const leaf = Keymap.isModEvent(event)
			? this.app.workspace.getLeaf(event.shiftKey ? "split" : "tab")
			: this.app.workspace.getLeaf(false);
		void leaf.openFile(file);
	}

	// ── Command API (used by main.ts commands) ────────────────────────

	focusOnPath(path: string): void {
		const id = this.model?.pathToId.get(path);
		if (id !== undefined) this.enterFocus(id);
	}

	async exportPngFile(): Promise<void> {
		const blob = await this.renderer?.exportPng();
		if (!blob) {
			new Notice("Could not create the PNG");
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
		return new ControlPanel(this.contentEl, state, this.plugin.settings.semantics, {
			onChange: (next) => {
				void this.plugin.savePanelState(next);
				this.applyAllPanelState(next);
			},
			onReheat: () => this.regroup(),
			onClusterClick: (index) => this.zoomToCluster(index),
			onClusterToggle: (index) => this.toggleCluster(index),
			onSemanticChange: (settings) => this.handleSemanticSettings(settings),
			onTrailReplay: () => this.replayTrail(),
			onShowHiddenNodes: () => this.resetHiddenNodes(),
			onPresetApply: (index) => void this.applyViewPreset(index),
			onPresetSaveRequest: () => {
				new PromptModal(this.app, "View preset name", "My view", (name) =>
					void this.saveViewPreset(name)
				).open();
			},
			onPresetDelete: (index) => void this.deleteViewPreset(index),
		});
	}

	// ── View presets ──────────────────────────────────────────────────

	private async applyViewPreset(index: number): Promise<void> {
		const preset = this.plugin.settings.viewPresets[index];
		if (!preset) return;
		await this.updatePanelState(() => preset.panel);
		new Notice(`View "${preset.name}" applied`);
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
		this.panel?.setViewPresets(next);
		new Notice(at >= 0 ? `Preset "${name}" overwritten` : `Preset "${name}" saved`);
	}

	private async deleteViewPreset(index: number): Promise<void> {
		const existing = this.plugin.settings.viewPresets;
		const preset = existing[index];
		if (!preset) return;
		const next = existing.filter((_, i) => i !== index);
		await this.plugin.saveViewPresets(next);
		this.panel?.setViewPresets(next);
		new Notice(`Preset "${preset.name}" deleted`);
	}

	/** Apply every visual consequence of a panel state, in one place. */
	private applyAllPanelState(state: PanelState): void {
		this.applyEncoding(state);
		this.applyOverlays(state);
		this.redrawBubbles();
		this.syncTimelineAndTrail(state);
		this.applyPhysics(state);
		this.renderer?.setLabelOptions(
			state.labels.fontSize, state.labels.zoomThreshold,
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
		this.panel.setViewPresets(this.plugin.settings.viewPresets);
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
		const count = this.model.nodes.length;
		const depths = new Float32Array(count);
		const SPREAD = 700;
		if (state.view3d.depthSource === "cluster" && this.metrics) {
			const layers = Math.max(this.metrics.communityCount, 1);
			for (let i = 0; i < count; i++) {
				depths[i] = ((this.metrics.community[i] + 0.5) / layers - 0.5) * SPREAD;
			}
		} else if (state.view3d.depthSource === "age") {
			let min = Infinity, max = -Infinity;
			for (const f of this.facts) {
				if (f.ctime < min) min = f.ctime;
				if (f.ctime > max) max = f.ctime;
			}
			const range = Math.max(max - min, 1);
			for (let i = 0; i < count; i++) {
				depths[i] = ((this.facts[i].ctime - min) / range - 0.5) * SPREAD;
			}
		}
		return depths;
	}

	private lastPhysics = "";

	private lastFreeLayout: boolean | null = null;

	/** Push slider values into the layout worker; reheat so they take hold. */
	private applyPhysics(state: PanelState): void {
		const key = JSON.stringify(state.physics);
		if (key === this.lastPhysics) return;
		this.lastPhysics = key;
		this.layout?.setParams(state.physics);

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
		const durationMs = 4000;
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
		await this.savePositions();
		this.layout?.stop();
		this.layout = null;
		this.metricsClient?.stop();
		this.metricsClient = null;
		this.searchBar?.destroy();
		this.searchBar = null;
		this.toolBar?.destroy();
		this.toolBar = null;
		this.filterChips?.destroy();
		this.filterChips = null;
		this.semanticUnsubscribe?.();
		this.semanticUnsubscribe = null;
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

function basename(path: string): string {
	const base = path.slice(path.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}
