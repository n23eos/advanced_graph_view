import { ChangesPanel, type ChangesData } from "../ui/ChangesPanel";
import { ChangesClient } from "../workers/ChangesClient";
import { coolingClusters, notesChangedSince, type ChangeCategory, type LinkChange, type TopologyDiff } from "../analysis/graphChanges";
import { closestSnapshotBefore } from "../data/graphSnapshots";
import type { GraphModel } from "../data/GraphStore";
import type { NodeFacts } from "../encoding/metrics";
import type { GraphMetrics } from "../workers/MetricsClient";
import type { GraphRenderer } from "../render/GraphRenderer";
import type { GraphInsightSettings } from "../settings/schema";
import type GraphInsightPlugin from "../main";

export interface ChangesControllerDeps {
	getChangesPanel(): ChangesPanel | null;
	setChangesPanel(value: ChangesPanel | null): void;
	getChangesClient(): ChangesClient | null;
	setChangesClient(value: ChangesClient | null): void;
	getChangesData(): ChangesData | null;
	setChangesData(value: ChangesData | null): void;
	getChangesGeneration(): number;
	setChangesGeneration(value: number): void;
	getChangesHighlight(): Set<number> | null;
	setChangesHighlight(value: Set<number> | null): void;
	getChangesSelection(): { periodDays: 7 | 30; category: ChangeCategory | null };
	setChangesSelection(value: { periodDays: 7 | 30; category: ChangeCategory | null }): void;
	getClosing(): boolean;
	getClusterNames(): string[];
	getContentEl(): HTMLElement;
	getFacts(): NodeFacts[];
	getMetrics(): GraphMetrics | null;
	getModel(): GraphModel | null;
	getPathDrawn(): boolean;
	setPathDrawn(value: boolean): void;
	getPlugin(): Pick<GraphInsightPlugin, "snapshotsLoaded" | "ensureSnapshots" | "snapshotStore" | "usageLog"> & { settings: Pick<GraphInsightSettings, "openInSidePane"> };
	getRenderer(): Pick<GraphRenderer, "zoomToNodes" | "setPathHighlight"> | null;
	ensureChangesPanel(): void;
	refreshChanges(): Promise<void>;
	selectChangesCategory(category: ChangeCategory | null): void;
	openNode(nodeId: number, newTab: boolean): void;
	focusChangesLink(link: LinkChange): void;
	clusterNodeIds(communityId: number): number[];
	applyChangesMask(): void;
	recomputeVisual(): void;
}

export class ChangesController {
	constructor(private readonly deps: ChangesControllerDeps) {}

	private get changesPanel() { return this.deps.getChangesPanel(); }
	private set changesPanel(value: ChangesPanel | null) { this.deps.setChangesPanel(value); }
	private get changesClient() { return this.deps.getChangesClient(); }
	private set changesClient(value: ChangesClient | null) { this.deps.setChangesClient(value); }
	private get changesData() { return this.deps.getChangesData(); }
	private set changesData(value: ChangesData | null) { this.deps.setChangesData(value); }
	private get changesGeneration() { return this.deps.getChangesGeneration(); }
	private set changesGeneration(value: number) { this.deps.setChangesGeneration(value); }
	private get changesHighlight() { return this.deps.getChangesHighlight(); }
	private set changesHighlight(value: Set<number> | null) { this.deps.setChangesHighlight(value); }
	private get changesSelection() { return this.deps.getChangesSelection(); }
	private set changesSelection(value: { periodDays: 7 | 30; category: ChangeCategory | null }) { this.deps.setChangesSelection(value); }
	private get closing() { return this.deps.getClosing(); }
	private get clusterNames() { return this.deps.getClusterNames(); }
	private get contentEl() { return this.deps.getContentEl(); }
	private get facts() { return this.deps.getFacts(); }
	private get metrics() { return this.deps.getMetrics(); }
	private get model() { return this.deps.getModel(); }
	private get pathDrawn() { return this.deps.getPathDrawn(); }
	private set pathDrawn(value: boolean) { this.deps.setPathDrawn(value); }
	private get plugin() { return this.deps.getPlugin(); }
	private get renderer() { return this.deps.getRenderer(); }

	toggleChangesPanel(): void {
		if (this.changesPanel?.isShown) {
			this.changesPanel.hide();
			return;
		}
		this.deps.ensureChangesPanel();
		this.changesPanel?.show();
		void this.deps.refreshChanges();
	}

	ensureChangesPanel(): void {
		if (this.changesPanel) return;
		this.changesPanel = new ChangesPanel(this.contentEl, {
			onPeriodChange: (days) => {
				this.changesSelection = { ...this.changesSelection, periodDays: days };
				this.changesPanel?.setState(days, this.changesSelection.category);
				void this.deps.refreshChanges();
			},
			onCategorySelect: (category) => this.deps.selectChangesCategory(category),
			onOpenNote: (path) => {
				const id = this.model?.pathToId.get(path);
				if (id !== undefined) this.deps.openNode(id, !this.plugin.settings.openInSidePane);
			},
			onFocusLink: (link) => this.deps.focusChangesLink(link),
			onFocusCluster: (id) => this.renderer?.zoomToNodes(this.deps.clusterNodeIds(id)),
			onClose: () => this.changesPanel?.hide(),
		});
		this.changesPanel.setState(this.changesSelection.periodDays, this.changesSelection.category);
	}

	async refreshChanges(): Promise<void> {
		if (this.closing || !this.model) return;
		const generation = ++this.changesGeneration;
		// A new period supersedes the old request, including its worker.
		this.changesClient?.stop();
		this.changesPanel?.setData(null); // skeleton - the view stays interactive
		if (!this.plugin.snapshotsLoaded) {
			try {
				await this.plugin.ensureSnapshots();
			} catch (error) {
				console.error("Advanced Graph View: snapshot loading failed", error);
				return;
			}
			if (this.closing || generation !== this.changesGeneration || !this.model) return;
		}
		const now = Date.now();
		const periodStart = now - this.changesSelection.periodDays * 24 * 60 * 60 * 1000;
		const snapshot = closestSnapshotBefore(this.plugin.snapshotStore, periodStart, this.model.scope);

		const nodes = this.model.nodes.filter(node => node.kind !== "unresolved").map((node) => ({
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
				// Closing or choosing another period cancels the old request.
			}
		}

		if (generation !== this.changesGeneration) return;
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
		this.deps.applyChangesMask();
	}

	selectChangesCategory(category: ChangeCategory | null): void {
		this.changesSelection = { ...this.changesSelection, category };
		this.changesPanel?.setState(this.changesSelection.periodDays, category);
		this.deps.applyChangesMask();
	}

	applyChangesMask(): void {
		const { category } = this.changesSelection;
		const data = this.changesData;
		if (!category || !data || !this.model) {
			this.changesHighlight = null;
			this.deps.recomputeVisual();
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
					for (const id of this.deps.clusterNodeIds(cluster.id)) ids.add(id);
				}
				break;
		}
		this.changesHighlight = ids;
		this.deps.recomputeVisual();
	}

	focusChangesLink(link: LinkChange): void {
		const from = this.model?.pathToId.get(link.fromPath);
		const to = this.model?.pathToId.get(link.toPath);
		if (from === undefined || to === undefined) return;
		this.renderer?.setPathHighlight([from, to]);
		this.pathDrawn = true;
		this.renderer?.zoomToNodes([from, to]);
	}
}
