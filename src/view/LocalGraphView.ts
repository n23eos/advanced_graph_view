/**
 * Local 3D graph pane: the BFS neighborhood of the active note, rendered with
 * the same GraphRenderer/LayoutClient pair as the main view but with none of
 * its panel machinery. A depth slider (1–4) cuts the ring count, an export
 * button writes the neighborhood as a Markdown note next to the root.
 */
import { ItemView, Notice, TFile, debounce, setIcon, type WorkspaceLeaf } from "obsidian";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { buildNeighborhood, type Neighborhood } from "../analysis/neighborhood";
import { focusFalloff } from "../analysis/focus";
import { localGraphMarkdown } from "../export/localGraphMarkdown";
import { GraphRenderer } from "../render/GraphRenderer";
import { LayoutClient } from "../workers/LayoutClient";
import { adaptPhysicsToGraphSize } from "../ui/layoutDensity";
import { ringTints } from "../analysis/ringTints";
import { activePreset } from "../render/theme";
import { degreeRadius } from "../render/nodeAppearance";
import { AutoFitGate } from "./autoFitGate";
import { t } from "../i18n";
import type GraphInsightPlugin from "../main";

export const LOCAL_GRAPH_VIEW_TYPE = "graph-insight-local";

const MIN_DEPTH = 1;
const MAX_DEPTH = 4;
const DEFAULT_DEPTH = 2;
/** The note the pane is about is drawn this much bigger than its links. */
const ROOT_SIZE_BOOST = 1.6;

export class LocalGraphView extends ItemView {
	private renderer: GraphRenderer | null = null;
	private layout: LayoutClient | null = null;
	private readonly autoFit = new AutoFitGate();
	private neighborhood: Neighborhood | null = null;
	private rootPath: string | null = null;
	private depth = DEFAULT_DEPTH;
	private view3d = true;
	private emptyState: HTMLElement | null = null;
	private tooltip: HTMLElement | null = null;
	/** Full-vault model, rebuilt only when the metadata cache says it changed.
	 *  Switching notes or depth re-cuts the neighborhood from this. */
	private vaultModel: GraphModel | null = null;

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

		this.depth = this.plugin.settings.localGraph.depth;
		this.view3d = this.plugin.settings.localGraph.view3d;

		this.buildHeader(container);
		this.emptyState = container.createDiv({
			cls: "graph-insight-empty",
			text: t("localGraph.empty"),
		});
		this.tooltip = container.createDiv({ cls: "graph-insight-tooltip" });
		this.tooltip.hide();

		this.renderer = new GraphRenderer({
			onNodeHover: (nodeId, clientX, clientY) => this.showTooltip(nodeId, clientX, clientY),
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
				this.invalidateModel();
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
			void this.plugin.saveLocalGraph({ depth: this.depth, view3d: this.view3d });
			if (this.rootPath) this.refresh(this.rootPath);
		});

		const toggle3D = header.createEl("button", { cls: "graph-insight-tool" });
		setIcon(toggle3D, "box");
		toggle3D.setAttribute("aria-label", t("localGraph.toggle3d"));
		toggle3D.toggleClass("is-active", this.view3d);
		toggle3D.addEventListener("click", () => {
			this.view3d = !this.view3d;
			toggle3D.toggleClass("is-active", this.view3d);
			void this.plugin.saveLocalGraph({ depth: this.depth, view3d: this.view3d });
			if (this.rootPath) this.refresh(this.rootPath);
		});

		const exportButton = header.createEl("button", { text: t("localGraph.export") });
		exportButton.addEventListener("click", () => void this.exportMarkdown());
	}

	private showTooltip(nodeId: number | null, clientX: number, clientY: number): void {
		if (!this.tooltip) return;
		const node = nodeId === null ? null : this.neighborhood?.model.nodes[nodeId];
		if (!node) {
			this.tooltip.hide();
			return;
		}
		const depth = this.neighborhood!.depths[node.id];
		this.tooltip.setText(
			depth === 0 ? node.name : `${node.name} — ${t("localGraph.mdLevel", { depth: String(depth) })}`
		);
		const bounds = this.contentEl.getBoundingClientRect();
		this.tooltip.style.left = `${clientX - bounds.left + 12}px`;
		this.tooltip.style.top = `${clientY - bounds.top + 12}px`;
		this.tooltip.show();
	}

	/** Drop the cached vault model so the next refresh rebuilds it. */
	private invalidateModel(): void {
		this.vaultModel = null;
	}

	/** Rebuild the neighborhood around `path` and hand it to renderer+worker. */
	private refresh(path: string): void {
		if (!this.renderer || !this.layout) return;
		if (!this.vaultModel) {
			const cache = this.app.metadataCache;
			const files = this.app.vault.getMarkdownFiles().map((f) => f.path);
			this.vaultModel = buildGraphModel(files, cache.resolvedLinks, cache.unresolvedLinks);
		}
		const model = this.vaultModel;
		const rootId = model.pathToId.get(path);
		// The root was deleted or renamed out from under us: show the empty
		// state rather than leaving a stale neighborhood on screen.
		if (rootId === undefined) {
			this.rootPath = null;
			this.neighborhood = null;
			this.emptyState?.toggle(true);
			return;
		}

		this.rootPath = path;
		const neighborhood = buildNeighborhood(model, rootId, this.depth);
		this.neighborhood = neighborhood;
		this.emptyState?.toggle(false);

		const sub = neighborhood.model;
		this.renderer.setModel(sub);
		this.renderer.set3DMode(this.view3d);
		this.renderer.setCameraFocal(this.plugin.settings.panel.view3d.focal);

		const labels = this.plugin.settings.panel.labels;
		this.renderer.setLabelOptions(true, labels.fontSize, 0, sub.nodes.length, labels.scaleWithZoom);
		const edges = this.plugin.settings.panel.edges;
		this.renderer.setEdgeStyle(true, edges.width, edges.opacity);

		// Same scheme as the main graph, sampled by ring so distance reads as
		// color instead of leaving the whole neighborhood one flat grey.
		const preset = activePreset(this.plugin.settings.panel.colorPreset);
		this.renderer.setVisualStyle(preset.glow === true, preset.backdrop ?? null);
		// Size still comes from how linked a note is — a hub neighbor has to
		// look like a hub — with the root scaled up as the anchor of the view.
		const sizes = new Float32Array(sub.nodes.length);
		const glow = new Float32Array(sub.nodes.length);
		for (const node of sub.nodes) {
			const anchor = neighborhood.depths[node.id] === 0 ? ROOT_SIZE_BOOST : 1;
			sizes[node.id] =
				degreeRadius(node.inCount + node.outCount) * anchor * this.plugin.settings.panel.nodeScale;
			glow[node.id] = 1;
		}
		this.renderer.applyEncoding(sizes, ringTints(neighborhood.depths, this.depth, preset), glow);

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
		this.layout.start(sub, undefined, this.view3d ? 3 : 2);
		const physics = this.plugin.settings.panel.physics;
		this.layout.setParams({
			...adaptPhysicsToGraphSize(physics, sub.nodes.length),
			freeLayout: true,
			disabled: false,
		});
	}

	/** Open in the main editor area, never in this sidebar leaf: `getLeaf(false)`
	 *  called from a sidebar can hand back the sidebar itself and replace the
	 *  graph with the note. */
	private openNode(nodeId: number, newTab = false): void {
		const path = this.neighborhood?.model.nodes[nodeId]?.path;
		if (!path) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const recent = this.app.workspace.getMostRecentLeaf();
		const reusable = !newTab && recent !== null && recent !== this.leaf ? recent : null;
		void (reusable ?? this.app.workspace.getLeaf("tab")).openFile(file);
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
