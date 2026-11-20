import { Notice, type App } from "obsidian";
import type { GraphModel } from "../data/GraphStore";
import type { GraphRenderer } from "../render/GraphRenderer";
import type { GraphInsightSettings } from "../settings/schema";
import type { PanelState } from "../ui/ControlPanel";
import type { CameraWidget } from "../ui/CameraWidget";
import type { Adjacency } from "../analysis/focus";
import type { TopicMapSource } from "../export/topicMapMarkdown";
import { ExploreSession } from "../explore/ExploreSession";
import { DEFAULT_EXPLORE_TUNING } from "../explore/ExploreController";
import { NavigationTrail } from "../explore/navigationTrail";
import { ExploreNoteModal } from "../ui/ExploreNoteModal";
import { motionSeconds } from "../render/motion";
import { t } from "../i18n";

export interface ExploreBindingsDeps {
	getApp(): App;
	getRenderer(): GraphRenderer | null;
	getModel(): GraphModel | null;
	getExploreSession(): ExploreSession | null;
	setExploreSession(value: ExploreSession | null): void;
	getExploreDetached(): boolean;
	setExploreDetached(value: boolean): void;
	getExploreTrail(): NavigationTrail | null;
	setExploreTrail(value: NavigationTrail | null): void;
	getExploreOverride(): boolean;
	setExploreOverride(value: boolean): void;
	getFocusRootId(): number | null;
	getTooltip(): HTMLElement | null;
	getExploreFocus(): { centerId: number; neighbors: readonly number[] } | null;
	setExploreFocus(value: { centerId: number; neighbors: readonly number[] } | null): void;
	getViewWindow(): Window | null;
	getCameraWidget(): Pick<CameraWidget, "setExploring"> | null;
	getExploreNoteModal(): ExploreNoteModal | null;
	setExploreNoteModal(value: ExploreNoteModal | null): void;
	getFocusBar(): HTMLElement | null;
	getRebuildDeferred(): boolean;
	setRebuildDeferred(value: boolean): void;
	getPlugin(): { settings: Pick<GraphInsightSettings, "panel" | "openInSidePane"> };
	getPanelState(): PanelState;
	getTooltipNodeId(): number | null;
	setTooltipNodeId(value: number | null): void;
	getContentEl(): HTMLElement;
	getIsExploring(): boolean;
	getHiddenMask(): Uint8Array | null;
	applyExploreOverride(): void;
	exitFocus(): void;
	clearPreviewTimer(): void;
	graphAdjacency(): Adjacency;
	recomputeVisual(): void;
	renderExploreBar(): void;
	showExploreTarget(nodeId: number | null, clientX: number, clientY: number): void;
	applyAllPanelState(state: PanelState, prev?: PanelState): void;
	rebuildGraph(): Promise<void>;
	enterExplore(startId?: number): Promise<void>;
	navigateExploreTo(nodeId: number): void;
	openExploreNotePicker(): void;
	openNode(nodeId: number, newTab: boolean): void;
	previousExploreIndex(): number | null;
	exploreBack(): void;
	detachExplore(): void;
	openTopicMapExport(source: TopicMapSource, rootId: number | null, flatIds?: number[]): void;
	exitExplore(): Promise<void>;
	renderTrail(host: HTMLElement, trail: NavigationTrail, go: (nodeId: number) => void): void;
}

export function applyExplorePanelOverride(state: PanelState): PanelState {
	return {
		...state,
		view3d: { ...state.view3d, enabled: true },
		physics: { ...state.physics, disabled: true },
	};
}

export class ExploreBindings {
	constructor(private readonly deps: ExploreBindingsDeps) {}

	private get app() { return this.deps.getApp(); }
	private get renderer() { return this.deps.getRenderer(); }
	private get model() { return this.deps.getModel(); }
	private get exploreSession() { return this.deps.getExploreSession(); }
	private set exploreSession(value: ExploreSession | null) { this.deps.setExploreSession(value); }
	private get exploreDetached() { return this.deps.getExploreDetached(); }
	private set exploreDetached(value: boolean) { this.deps.setExploreDetached(value); }
	private get exploreTrail() { return this.deps.getExploreTrail(); }
	private set exploreTrail(value: NavigationTrail | null) { this.deps.setExploreTrail(value); }
	private get exploreOverride() { return this.deps.getExploreOverride(); }
	private set exploreOverride(value: boolean) { this.deps.setExploreOverride(value); }
	private get focusRootId() { return this.deps.getFocusRootId(); }
	private get tooltip() { return this.deps.getTooltip(); }
	private get exploreFocus() { return this.deps.getExploreFocus(); }
	private set exploreFocus(value: { centerId: number; neighbors: readonly number[] } | null) { this.deps.setExploreFocus(value); }
	private get viewWindow() { return this.deps.getViewWindow(); }
	private get cameraWidget() { return this.deps.getCameraWidget(); }
	private get exploreNoteModal() { return this.deps.getExploreNoteModal(); }
	private set exploreNoteModal(value: ExploreNoteModal | null) { this.deps.setExploreNoteModal(value); }
	private get focusBar() { return this.deps.getFocusBar(); }
	private get rebuildDeferred() { return this.deps.getRebuildDeferred(); }
	private set rebuildDeferred(value: boolean) { this.deps.setRebuildDeferred(value); }
	private get plugin() { return this.deps.getPlugin(); }
	private get tooltipNodeId() { return this.deps.getTooltipNodeId(); }
	private set tooltipNodeId(value: number | null) { this.deps.setTooltipNodeId(value); }
	private get contentEl() { return this.deps.getContentEl(); }
	private get isExploring() { return this.deps.getIsExploring(); }
	private get hiddenMask() { return this.deps.getHiddenMask(); }

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
			this.deps.applyExploreOverride();
		}
		this.exploreDetached = false;

		if (this.focusRootId !== null) this.deps.exitFocus();
		// Clear any full hover card before showing Explore signposts.
		this.deps.clearPreviewTimer();
		this.tooltip?.hide();
		this.exploreSession = new ExploreSession(
			this.renderer,
			this.deps.graphAdjacency(),
			centerId,
			{
				onFocusChanged: (id, neighbors) => {
					this.exploreFocus = { centerId: id, neighbors };
					// Every arrival lands in the trail; back/breadcrumb flights
					// arrive at the already-active crumb, which push() ignores.
					const node = this.model?.nodes[id];
					if (node) this.exploreTrail?.push({ path: node.path, label: node.name });
					this.deps.recomputeVisual();
					this.deps.renderExploreBar();
				},
			},
			// A reduced-motion user gets the same trip with the flight cut out.
			{ flightSeconds: motionSeconds(DEFAULT_EXPLORE_TUNING.flightSeconds, this.viewWindow ?? undefined) }
		);
		this.cameraWidget?.setExploring(true);
		if (!reanchoring) new Notice(t("notice.exploreStart"), 5000);
	}

	detachExplore(): void {
		if (!this.exploreSession) return;
		this.exploreSession.stop();
		this.exploreSession = null;
		this.exploreFocus = null;
		this.exploreDetached = true;
		this.deps.renderExploreBar();
		this.deps.showExploreTarget(null, 0, 0);
		this.deps.recomputeVisual();
		new Notice(t("notice.exploreDetached"), 5000);
	}

	applyExploreOverride(): void {
		this.deps.applyAllPanelState(applyExplorePanelOverride(this.deps.getPanelState()));
	}

	async exitExplore(): Promise<void> {
		if (!this.exploreSession && !this.exploreDetached) return;
		this.exploreNoteModal?.close();
		this.exploreNoteModal = null;
		this.exploreSession?.stop();
		this.exploreSession = null;
		this.exploreFocus = null;
		this.exploreTrail = null;
		this.exploreDetached = false;
		this.focusBar?.hide();
		this.cameraWidget?.setExploring(false);
		this.deps.showExploreTarget(null, 0, 0);

		if (this.exploreOverride) {
			this.exploreOverride = false;
			// The saved settings were never touched, so putting them back is
			// just re-applying them.
			this.deps.applyAllPanelState(this.deps.getPanelState());
		}
		this.deps.recomputeVisual();

		if (this.rebuildDeferred) {
			this.rebuildDeferred = false;
			await this.deps.rebuildGraph();
		}
	}

	showExploreTarget(nodeId: number | null, clientX: number, clientY: number): void {
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

	navigateExploreTo(nodeId: number): void {
		if (!this.isExploring || !this.model?.nodes[nodeId] || this.hiddenMask?.[nodeId] === 1) return;
		this.renderer?.setSelected(nodeId);
		if (this.exploreDetached) void this.deps.enterExplore(nodeId);
		else if (this.exploreSession?.currentId !== nodeId) this.exploreSession?.travelTo(nodeId);
	}

	openExploreNotePicker(): void {
		if (!this.isExploring || !this.model || this.exploreNoteModal) return;
		const trail = this.exploreTrail;
		const modal = new ExploreNoteModal(this.app,
			() => this.model?.nodes.filter((node) => this.hiddenMask?.[node.id] !== 1) ?? [],
			(path) => {
				// Resolve paths at selection time; ids and filters may have changed.
				if (this.exploreTrail !== trail) return;
				const id = this.model?.pathToId.get(path);
				if (id !== undefined) this.deps.navigateExploreTo(id);
			},
			() => { if (this.exploreNoteModal === modal) this.exploreNoteModal = null; },
		);
		this.exploreNoteModal = modal;
		modal.open();
	}

	renderExploreBar(): void {
		if (!this.focusBar || !this.model || (!this.exploreFocus && !this.exploreDetached)) return;
		const focus = this.exploreFocus;
		this.focusBar.empty();
		this.focusBar.show();
		this.focusBar.createSpan({ text: focus
			? t("explore.status", { name: this.model.nodes[focus.centerId].name, count: focus.neighbors.length })
			: t("explore.detached.status") });
		const choose = this.focusBar.createEl("button", { text: t("explore.choose") });
		choose.addEventListener("click", () => this.deps.openExploreNotePicker());
		if (focus) {
			const open = this.focusBar.createEl("button", { text: t("explore.open") });
			open.setAttribute("aria-label", t("explore.open.hint"));
			open.addEventListener("click", () => this.deps.openNode(focus.centerId, !this.plugin.settings.openInSidePane));
		}
		const back = this.focusBar.createEl("button", { text: t("explore.back") });
		back.disabled = this.deps.previousExploreIndex() === null;
		back.addEventListener("click", () => this.deps.exploreBack());
		if (focus) {
			const detach = this.focusBar.createEl("button", { text: t("explore.detach") });
			detach.setAttribute("aria-label", t("explore.detach.hint"));
			detach.addEventListener("click", () => this.deps.detachExplore());
			const exportButton = this.focusBar.createEl("button", { text: t("topicmap.modalTitle") });
			exportButton.setAttribute("aria-label", t("topicmap.export"));
			exportButton.addEventListener("click", () => {
				if (this.exploreFocus) this.deps.openTopicMapExport("explore", this.exploreFocus.centerId);
			});
		}
		const exit = this.focusBar.createEl("button", { text: t("explore.exit") });
		exit.addEventListener("click", () => void this.deps.exitExplore());
		if (this.exploreTrail && this.exploreTrail.items.length > 1) {
			this.deps.renderTrail(this.focusBar, this.exploreTrail, (id) => this.deps.navigateExploreTo(id));
		}
	}
}
