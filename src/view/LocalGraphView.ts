import { watchAttachmentInventory } from "./attachmentInventory";
import { nodeDisplayPath } from "../data/graphNodes";
import { buildVaultGraph, graphNodeFile } from "../data/vaultGraph";
/**
 * Local 3D graph pane: the BFS neighborhood of the active note, rendered with
 * the same GraphRenderer/LayoutClient pair as the main view but with none of
 * its panel machinery. A depth slider (1–4) cuts the ring count, an export
 * button writes the neighborhood as a Markdown note next to the root.
 */
import {
	ItemView,
	Notice,
	TFile,
	debounce,
	setIcon,
	type Debouncer,
	type EventRef,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import { type GraphModel } from "../data/GraphStore";
import { buildNeighborhood, type Neighborhood } from "../analysis/neighborhood";
import { focusFalloff } from "../analysis/focus";
import { localGraphMarkdown } from "../export/localGraphMarkdown";
import { GraphRenderer } from "../render/GraphRenderer";
import { LayoutClient } from "../workers/LayoutClient";
import { adaptPhysicsToGraphSize } from "../ui/layoutDensity";
import { ringTints } from "../analysis/ringTints";
import { activePreset, isLightTheme } from "../render/theme";
import { effectiveNodeStyle } from "../render/nodeStyle";
import { degreeRadius } from "../render/nodeAppearance";
import { AutoFitGate } from "./autoFitGate";
import { observeRendererVisibility } from "./rendererVisibility";
import { t } from "../i18n";
import { renderGraphStartupError } from "../ui/GraphStartupError";
import type GraphInsightPlugin from "../main";
import {
	applyGraphAppearance,
	applyRendererAppearanceFlag,
	createGraphAppearance,
	type GraphAppearance,
} from "../settings/appearance";
import { normalizeLocalGraphViewState } from "./workspaceState";

export const LOCAL_GRAPH_VIEW_TYPE = "graph-insight-local";

const MIN_DEPTH = 1;
const MAX_DEPTH = 4;
const DEFAULT_DEPTH = 2;
/** The note the pane is about is drawn this much bigger than its links. */
const ROOT_SIZE_BOOST = 1.6;

export class LocalGraphView extends ItemView {
	private renderer: GraphRenderer | null = null;
	private stopObservingRendererVisibility: (() => void) | null = null;
	private stopWindowMigration: (() => void) | null = null;
	private viewWindow: Window | null = null;
	private viewDocument: Document | null = null;
	private resizeFrame: number | null = null;
	private layout: LayoutClient | null = null;
	private readonly autoFit = new AutoFitGate();
	private neighborhood: Neighborhood | null = null;
	private rootPath: string | null = null;
	private depth = DEFAULT_DEPTH;
	private view3d = true;
	private emptyState: HTMLElement | null = null;
	private tooltip: HTMLElement | null = null;
	private closing = false;
	private openGeneration = 0;
	private fileOpenEvent: EventRef | null = null;
	private metadataResolvedEvent: EventRef | null = null;
	private stopAttachmentInventory: (() => void) | null = null;
	private refreshOnResolve: Debouncer<[], void> | null = null;
	private reopenRequested = false;
	private reopenPromise: Promise<void> | null = null;
	private closeEpoch = 0;
	private readonly cancelAutoFit = () => this.autoFit.cancel();
	private appearance: GraphAppearance;
	/** Full-vault model, rebuilt only when the metadata cache says it changed.
	 *  Switching notes or depth re-cuts the neighborhood from this. */
	private vaultModel: GraphModel | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: GraphInsightPlugin) {
		super(leaf);
		this.appearance = createGraphAppearance(this.localFallbackPanel(), "legacy");
	}

	private localFallbackPanel() {
		const panel = this.plugin.settings.panel;
		return {
			...panel,
			view3d: { ...panel.view3d, enabled: this.plugin.settings.localGraph.view3d },
		};
	}

	private get effectivePanelState() {
		return applyGraphAppearance(this.plugin.settings.panel, this.appearance);
	}

	private applyRendererAppearance(): void {
		applyRendererAppearanceFlag(this.renderer, this.appearance);
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

	getState(): Record<string, unknown> {
		return { version: 1, appearance: this.appearance };
	}

	async setState(state: unknown, _result: ViewStateResult): Promise<void> {
		const normalized = normalizeLocalGraphViewState(state, this.localFallbackPanel());
		if (!normalized) return;
		this.appearance = normalized.appearance;
		this.view3d = this.appearance.panel.view3d.enabled;
		this.applyRendererAppearance();
		if (this.rootPath && this.renderer) this.refresh(this.rootPath);
	}

	async onOpen(): Promise<void> {
		const openGeneration = ++this.openGeneration;
		this.closing = false;
		const container = this.contentEl;
		const viewDocument = container.ownerDocument;
		const viewWindow = viewDocument.defaultView ?? (container as HTMLElement & { win?: Window }).win;
		if (!viewWindow) throw new Error("Local graph host window is unavailable");
		this.viewDocument = viewDocument;
		this.viewWindow = viewWindow;
		this.registerWindowMigration(container);
		container.empty();
		container.addClass("graph-insight-container");

		this.depth = this.plugin.settings.localGraph.depth;
		this.view3d = this.effectivePanelState.view3d.enabled;

		this.buildHeader(container);
		const emptyState = container.createDiv({
			cls: "graph-insight-empty",
			text: t("localGraph.empty"),
		});
		this.emptyState = emptyState;
		const tooltip = container.createDiv({ cls: "graph-insight-tooltip" });
		tooltip.hide();
		this.tooltip = tooltip;

		const renderer = new GraphRenderer({
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
		this.renderer = renderer;
		this.applyRendererAppearance();
		try {
			await renderer.init(container, this.plugin.settings.renderScale);
		} catch (error) {
			renderer.destroy();
			if (this.renderer === renderer) this.renderer = null;
			if (this.emptyState === emptyState) this.emptyState = null;
			if (this.tooltip === tooltip) this.tooltip = null;
			if (!this.closing && this.openGeneration === openGeneration) {
				console.error("Advanced Graph View: local renderer startup failed", error);
				renderGraphStartupError(container, () => this.retryStartup(openGeneration));
			}
			return;
		}
		if (this.closing || this.openGeneration !== openGeneration || this.renderer !== renderer) {
			renderer.destroy();
			if (this.renderer === renderer) this.renderer = null;
			return;
		}
		this.stopObservingRendererVisibility?.();
		this.stopObservingRendererVisibility = observeRendererVisibility(container, renderer);
		this.resizeFrame = viewWindow.requestAnimationFrame(() => {
			if (this.openGeneration === openGeneration) this.resizeFrame = null;
			if (!this.closing && this.openGeneration === openGeneration && this.renderer === renderer) {
				renderer.resize();
			}
		});

		container.addEventListener("pointerdown", this.cancelAutoFit);
		container.addEventListener("wheel", this.cancelAutoFit);

		this.layout = new LayoutClient(
			(positions) => {
				this.renderer?.updatePositions(positions);
				// A fresh neighborhood starts as a knot at the origin and expands
				// over the next second. Framing only once it settles would leave
				// the camera aimed at the previous note's cloud until then — and
				// stranded there for good if the graph is touched meanwhile. Keep
				// re-framing every tick until the fit is spent or the user takes
				// the camera.
				if (this.autoFit.isPending()) this.renderer?.fitAll();
			},
			(positions) => {
				this.renderer?.updatePositions(positions);
				if (this.autoFit.consume()) this.renderer?.fitAll();
			}
		);

		this.fileOpenEvent = this.app.workspace.on(
			"file-open",
			(file) => {
				if (file && file.extension === "md") this.refresh(file.path);
			}
		);
		// "resolved" fires on every cache pass; rebuilding the whole model each
		// time would churn on big vaults, so trailing-edge debounce it.
		this.refreshOnResolve = debounce(
			() => {
				this.invalidateModel();
				if (this.rootPath) this.refresh(this.rootPath);
			},
			1000,
			true
		);
		this.metadataResolvedEvent = this.app.metadataCache.on("resolved", this.refreshOnResolve);
		if (this.plugin.settings.graphScope.attachments) {
			this.stopAttachmentInventory = watchAttachmentInventory(this.app.vault, () => this.refreshOnResolve?.());
		}

		const active = this.app.workspace.getActiveFile();
		const rootPath = active?.extension === "md" ? active.path : this.rootPath;
		if (rootPath) this.refresh(rootPath);
	}

	onResize(): void {
		this.renderer?.resize();
	}

	async onClose(): Promise<void> {
		this.closeEpoch++;
		this.reopenRequested = false;
		await this.teardown();
	}

	private async teardown(): Promise<void> {
		this.closing = true;
		this.openGeneration++;
		this.clearOpenListeners();
		this.stopObservingRendererVisibility?.();
		this.stopObservingRendererVisibility = null;
		if (this.resizeFrame !== null) this.viewWindow?.cancelAnimationFrame(this.resizeFrame);
		this.resizeFrame = null;
		this.layout?.stop();
		this.renderer?.destroy();
		this.renderer = null;
		this.layout = null;
		this.viewWindow = null;
		this.viewDocument = null;
	}

	reloadFromSettings(appearance?: GraphAppearance): Promise<void> {
		if (appearance) {
			const panel = applyGraphAppearance(this.plugin.settings.panel, appearance);
			this.appearance = createGraphAppearance({
				...panel,
				view3d: { ...panel.view3d, enabled: this.plugin.settings.localGraph.view3d },
			}, appearance.mode);
		}
		return this.reopen();
	}

	private reopen(): Promise<void> {
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
		await Promise.resolve();
		while (this.reopenRequested && closeEpoch === this.closeEpoch) {
			this.reopenRequested = false;
			this.clearOpenListeners();
			await this.teardown();
			if (closeEpoch !== this.closeEpoch) return;
			await this.onOpen();
		}
	}

	private clearOpenListeners(): void {
		this.stopAttachmentInventory?.();
		this.stopAttachmentInventory = null;
		this.stopWindowMigration?.();
		this.stopWindowMigration = null;
		this.contentEl.removeEventListener("pointerdown", this.cancelAutoFit);
		this.contentEl.removeEventListener("wheel", this.cancelAutoFit);
		if (this.fileOpenEvent) this.app.workspace.offref(this.fileOpenEvent);
		if (this.metadataResolvedEvent) this.app.metadataCache.offref(this.metadataResolvedEvent);
		this.refreshOnResolve?.cancel();
		this.fileOpenEvent = null;
		this.metadataResolvedEvent = null;
		this.refreshOnResolve = null;
	}

	private registerWindowMigration(fallback: HTMLElement): void {
		this.stopWindowMigration?.();
		const host = (this.containerEl as HTMLElement | undefined) ?? fallback;
		const subscribe = (host as unknown as {
			onWindowMigrated?: (listener: (win: Window) => void) => () => void;
		}).onWindowMigrated;
		if (typeof subscribe !== "function") {
			this.stopWindowMigration = null;
			return;
		}
		this.stopWindowMigration = subscribe.call(host, () => {
			this.clearOpenListeners();
			void this.reopen().catch((error) => {
				console.error("Advanced Graph View: local window migration reload failed", error);
			});
		});
	}

	private async retryStartup(generation: number): Promise<void> {
		if (this.closing || this.openGeneration !== generation) return;
		await this.onOpen();
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
			const panel = this.effectivePanelState;
			this.appearance = createGraphAppearance({
				...panel,
				view3d: { ...panel.view3d, enabled: this.view3d },
			}, this.appearance.mode);
			toggle3D.toggleClass("is-active", this.view3d);
			void this.plugin.saveLocalGraph({ depth: this.depth, view3d: this.view3d });
			void this.app.workspace.requestSaveLayout();
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
		const label = node.kind === "unresolved" ? nodeDisplayPath(node) : node.name;
		this.tooltip.setText(
			depth === 0 ? label : `${label} \u2014 ${t("localGraph.mdLevel", { depth: String(depth) })}`
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
			this.vaultModel = buildVaultGraph(this.app, this.plugin.settings.graphScope);
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
		const panel = this.effectivePanelState;
		this.renderer.setCameraFocal(panel.view3d.focal);

		const labels = panel.labels;
		this.renderer.setLabelOptions(true, labels.fontSize, 0, sub.nodes.length, labels.scaleWithZoom);
		const edges = panel.edges;
		this.renderer.setEdgeStyle(true, edges.width, edges.opacity);

		// Same scheme as the main graph, sampled by ring so distance reads as
		// color instead of leaving the whole neighborhood one flat grey.
		const preset = activePreset(panel.colorPreset, this.viewDocument ?? undefined);
		this.renderer.setVisualStyle(
			effectiveNodeStyle(panel.nodeStyle, isLightTheme(this.viewDocument ?? undefined)),
			preset.backdrop ?? null
		);
		// Size still comes from how linked a note is — a hub neighbor has to
		// look like a hub — with the root scaled up as the anchor of the view.
		const sizes = new Float32Array(sub.nodes.length);
		const glow = new Float32Array(sub.nodes.length);
		for (const node of sub.nodes) {
			const anchor = neighborhood.depths[node.id] === 0 ? ROOT_SIZE_BOOST : 1;
			sizes[node.id] =
				degreeRadius(node.inCount + node.outCount) * anchor * panel.nodeScale;
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
		const physics = panel.physics;
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
		const node = this.neighborhood?.model.nodes[nodeId];
		if (!node) return;
		const file = graphNodeFile(this.app, node);
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
