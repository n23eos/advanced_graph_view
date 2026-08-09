/**
 * Local 3D graph pane: the BFS neighborhood of the active note, rendered with
 * the same GraphRenderer/LayoutClient pair as the main view but with none of
 * its panel machinery. A depth slider (1–4) cuts the ring count, an export
 * button writes the neighborhood as a Markdown note next to the root.
 */
import { ItemView, Notice, TFile, debounce, type WorkspaceLeaf } from "obsidian";
import { buildGraphModel } from "../data/GraphStore";
import { buildNeighborhood, type Neighborhood } from "../analysis/neighborhood";
import { focusFalloff } from "../analysis/focus";
import { localGraphMarkdown } from "../export/localGraphMarkdown";
import { GraphRenderer } from "../render/GraphRenderer";
import { LayoutClient } from "../workers/LayoutClient";
import { adaptPhysicsToGraphSize } from "../ui/layoutDensity";
import { AutoFitGate } from "./autoFitGate";
import { t } from "../i18n";
import type GraphInsightPlugin from "../main";

export const LOCAL_GRAPH_VIEW_TYPE = "graph-insight-local";

const MIN_DEPTH = 1;
const MAX_DEPTH = 4;
const DEFAULT_DEPTH = 2;

export class LocalGraphView extends ItemView {
	private renderer: GraphRenderer | null = null;
	private layout: LayoutClient | null = null;
	private readonly autoFit = new AutoFitGate();
	private neighborhood: Neighborhood | null = null;
	private rootPath: string | null = null;
	private depth = DEFAULT_DEPTH;
	private emptyState: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: GraphInsightPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return LOCAL_GRAPH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t("localGraph.title");
	}

	getIcon(): string {
		return "orbit";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("graph-insight-container");

		this.buildHeader(container);
		this.emptyState = container.createDiv({
			cls: "graph-insight-empty",
			text: t("localGraph.empty"),
		});

		this.renderer = new GraphRenderer({
			onNodeHover: () => {},
			onNodeClick: (nodeId) => this.openNode(nodeId),
			onNodeDoubleClick: (nodeId) => this.openNode(nodeId),
			onNodeMiddleClick: (nodeId) => this.openNode(nodeId, true),
			onNodeContextMenu: () => {},
			onLassoSelect: () => {},
			onNodeDragStart: (nodeId) => this.layout?.dragStart(nodeId),
			onNodeDrag: (nodeId, x, y, z) => this.layout?.dragMove(nodeId, x, y, z),
			onNodeDragEnd: () => this.layout?.dragEnd(),
			onExploreAim: () => {},
			onExploreJump: () => {},
			onContextLost: () => {},
		});
		await this.renderer.init(container);
		window.requestAnimationFrame(() => this.renderer?.resize());

		this.registerDomEvent(container, "pointerdown", () => this.autoFit.cancel());
		this.registerDomEvent(container, "wheel", () => this.autoFit.cancel());

		this.layout = new LayoutClient(
			(positions) => this.renderer?.updatePositions(positions),
			(positions) => {
				this.renderer?.updatePositions(positions);
				if (this.autoFit.consume()) this.renderer?.fitAll();
			}
		);

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file && file.extension === "md") this.refresh(file.path);
			})
		);
		// "resolved" fires on every cache pass; rebuilding the whole model each
		// time would churn on big vaults, so trailing-edge debounce it.
		const refreshOnResolve = debounce(
			() => {
				if (this.rootPath) this.refresh(this.rootPath);
			},
			1000,
			true
		);
		this.registerEvent(this.app.metadataCache.on("resolved", refreshOnResolve));

		const active = this.app.workspace.getActiveFile();
		if (active && active.extension === "md") this.refresh(active.path);
	}

	onResize(): void {
		this.renderer?.resize();
	}

	async onClose(): Promise<void> {
		this.layout?.stop();
		this.renderer?.destroy();
		this.renderer = null;
		this.layout = null;
	}

	private buildHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: "graph-insight-local-header" });

		const label = header.createEl("label", { text: `${t("localGraph.depth")}: ${this.depth}` });
		const slider = header.createEl("input", { type: "range" });
		slider.min = String(MIN_DEPTH);
		slider.max = String(MAX_DEPTH);
		slider.value = String(this.depth);
		slider.addEventListener("input", () => {
			this.depth = Number(slider.value);
			label.setText(`${t("localGraph.depth")}: ${this.depth}`);
			if (this.rootPath) this.refresh(this.rootPath);
		});

		const exportButton = header.createEl("button", { text: t("localGraph.export") });
		exportButton.addEventListener("click", () => void this.exportMarkdown());
	}

	/** Rebuild the neighborhood around `path` and hand it to renderer+worker. */
	private refresh(path: string): void {
		if (!this.renderer || !this.layout) return;
		const cache = this.app.metadataCache;
		const files = this.app.vault.getMarkdownFiles().map((f) => f.path);
		const model = buildGraphModel(files, cache.resolvedLinks, cache.unresolvedLinks);
		const rootId = model.pathToId.get(path);
		if (rootId === undefined) return;

		this.rootPath = path;
		const neighborhood = buildNeighborhood(model, rootId, this.depth);
		this.neighborhood = neighborhood;
		this.emptyState?.toggle(false);

		const sub = neighborhood.model;
		this.renderer.setModel(sub);
		this.renderer.set3DMode(true);
		this.renderer.setCameraFocal(this.plugin.settings.panel.view3d.focal);

		const labels = this.plugin.settings.panel.labels;
		this.renderer.setLabelOptions(true, labels.fontSize, 0, sub.nodes.length, labels.scaleWithZoom);
		const edges = this.plugin.settings.panel.edges;
		this.renderer.setEdgeStyle(true, edges.width, edges.opacity);

		// Root pops via the highlight boost; rings fade with their distance.
		const highlight = new Uint8Array(sub.nodes.length);
		highlight[neighborhood.rootId] = 1;
		this.renderer.setHighlightMask(highlight);
		const alpha = new Float32Array(sub.nodes.length);
		for (let i = 0; i < alpha.length; i++) {
			alpha[i] = focusFalloff(neighborhood.depths[i], this.depth);
		}
		this.renderer.setAlphaFactors(alpha);

		this.autoFit.request();
		this.layout.start(sub, undefined, 3);
		const physics = this.plugin.settings.panel.physics;
		this.layout.setParams({
			...adaptPhysicsToGraphSize(physics, sub.nodes.length),
			freeLayout: true,
			disabled: false,
		});
	}

	private openNode(nodeId: number, newTab = false): void {
		const path = this.neighborhood?.model.nodes[nodeId]?.path;
		if (!path) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
	}

	/** Write the neighborhood as a Markdown note next to the root note. */
	async exportMarkdown(): Promise<void> {
		if (!this.neighborhood) return;
		const root = this.neighborhood.model.nodes[this.neighborhood.rootId];
		const folder = root.path.includes("/") ? root.path.slice(0, root.path.lastIndexOf("/") + 1) : "";
		const base = `${folder}${t("localGraph.title")} - ${root.name}`;

		let target = `${base}.md`;
		for (let suffix = 2; this.app.vault.getAbstractFileByPath(target) !== null; suffix++) {
			if (suffix > 100) return; // something is wrong with the vault; don't spin forever
			target = `${base} ${suffix}.md`;
		}

		const file = await this.app.vault.create(target, localGraphMarkdown(this.neighborhood));
		new Notice(t("localGraph.exported", { name: file.basename }));
		void this.app.workspace.getLeaf("tab").openFile(file);
	}
}
