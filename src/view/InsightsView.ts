/**
 * Insights dashboard (right sidebar): vault totals, top notes by opens and
 * PageRank, cooling hubs, 90-day activity spark.
 * Self-contained: builds its own model and runs its own metrics worker.
 */
import { ItemView, TFile, type WorkspaceLeaf } from "obsidian";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { countOverlayMatches } from "../analysis/overlays";
import { countRecentOpens } from "../data/UsageTracker";
import { MetricsClient, type GraphMetrics } from "../workers/MetricsClient";
import type GraphInsightPlugin from "../main";

export const INSIGHTS_VIEW_TYPE = "graph-insight-insights";

const TOP_COUNT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** "Cooling hub": top-PageRank note untouched for this long. */
const COOLING_DAYS = 60;

export class InsightsView extends ItemView {
	private metricsClient: MetricsClient | null = null;
	private model: GraphModel | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: GraphInsightPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return INSIGHTS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Graph Insights";
	}

	getIcon(): string {
		return "bar-chart-2";
	}

	async onOpen(): Promise<void> {
		this.metricsClient = new MetricsClient((metrics) => this.render(metrics));
		this.renderSkeleton();
		this.refresh();
	}

	private refresh(): void {
		const cache = this.app.metadataCache;
		const files = this.app.vault.getMarkdownFiles().map((f) => f.path);
		this.model = buildGraphModel(files, cache.resolvedLinks, cache.unresolvedLinks);
		this.metricsClient?.compute(this.model);
	}

	private renderSkeleton(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass("graph-insight-insights");
		el.createEl("h4", { text: "Graph Insights" });
		el.createDiv({ cls: "graph-insight-panel-hint", text: "Computing metrics…" });
	}

	private render(metrics: GraphMetrics): void {
		if (!this.model) return;
		const el = this.contentEl;
		el.empty();
		el.addClass("graph-insight-insights");
		const model = this.model;
		const log = this.plugin.usageLog;
		const now = Date.now();

		el.createEl("h4", { text: "Graph Insights" });

		// Totals
		const counts = countOverlayMatches(model);
		const totals = el.createDiv({ cls: "graph-insight-insights-totals" });
		const totalRow = (label: string, value: number) => {
			const row = totals.createDiv({ cls: "graph-insight-insights-total" });
			row.createSpan({ cls: "graph-insight-insights-total-value", text: String(value) });
			row.createSpan({ text: label });
		};
		totalRow("notes", model.nodes.length);
		totalRow("links", model.edges.length);
		totalRow("orphans", counts.orphans);
		totalRow("broken", counts.broken);

		this.renderSparkline(el);

		// Top by opens (30d)
		const byOpens = model.nodes
			.map((node) => ({ node, opens: countRecentOpens(log, node.path, 30, now) }))
			.filter((x) => x.opens > 0)
			.sort((a, b) => b.opens - a.opens)
			.slice(0, TOP_COUNT);
		this.renderList(el, "Top by opens (30 days)", byOpens.map((x) => ({
			path: x.node.path,
			label: x.node.name,
			value: String(x.opens),
		})));

		// Top by PageRank
		const byRank = model.nodes
			.map((node) => ({ node, rank: metrics.pagerank[node.id] }))
			.sort((a, b) => b.rank - a.rank)
			.slice(0, TOP_COUNT);
		this.renderList(el, "Top by PageRank", byRank.map((x) => ({
			path: x.node.path,
			label: x.node.name,
			value: (x.rank * 1000).toFixed(1),
		})));

		// Cooling hubs: high rank, stale edits
		const files = new Map(this.app.vault.getMarkdownFiles().map((f) => [f.path, f]));
		const cooling = byRank
			.concat(
				model.nodes
					.map((node) => ({ node, rank: metrics.pagerank[node.id] }))
					.sort((a, b) => b.rank - a.rank)
					.slice(TOP_COUNT, TOP_COUNT * 3)
			)
			.filter((x) => {
				const file = files.get(x.node.path);
				return file ? now - file.stat.mtime > COOLING_DAYS * DAY_MS : false;
			})
			.slice(0, TOP_COUNT);
		this.renderList(el, `Cooling hubs (untouched ${COOLING_DAYS}+ days)`, cooling.map((x) => ({
			path: x.node.path,
			label: x.node.name,
			value: `${Math.floor((now - (files.get(x.node.path)?.stat.mtime ?? now)) / DAY_MS)}d`,
		})));
	}

	/** 90-day opens activity sparkline from the usage log. */
	private renderSparkline(el: HTMLElement): void {
		const now = Date.now();
		const days = 90;
		const buckets = new Array<number>(days).fill(0);
		for (const usage of Object.values(this.plugin.usageLog)) {
			for (const [day, count] of Object.entries(usage.days)) {
				const age = Math.floor((now - new Date(day).getTime()) / DAY_MS);
				if (age >= 0 && age < days) buckets[days - 1 - age] += count;
			}
		}
		const canvas = el.createEl("canvas", { cls: "graph-insight-insights-spark" });
		canvas.width = 280;
		canvas.height = 32;
		const context = canvas.getContext("2d");
		if (!context) return;
		const max = Math.max(...buckets, 1);
		const accent = getComputedStyle(document.body).getPropertyValue("--interactive-accent").trim() || "#7c3aed";
		context.fillStyle = accent;
		context.globalAlpha = 0.6;
		const barWidth = canvas.width / days;
		buckets.forEach((count, i) => {
			const h = (count / max) * canvas.height;
			context.fillRect(i * barWidth, canvas.height - h, Math.max(barWidth - 0.5, 0.5), h);
		});
	}

	private renderList(
		el: HTMLElement,
		title: string,
		rows: { path: string; label: string; value: string }[]
	): void {
		if (rows.length === 0) return;
		const section = el.createDiv();
		section.createEl("h5", { text: title });
		for (const row of rows) {
			const rowEl = section.createDiv({ cls: "graph-insight-insights-row" });
			const label = rowEl.createSpan({ cls: "graph-insight-insights-label", text: row.label });
			label.addEventListener("click", () => this.openPath(row.path));
			rowEl.createSpan({ cls: "graph-insight-panel-count", text: row.value });
		}
	}

	private openPath(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
	}

	async onClose(): Promise<void> {
		this.metricsClient?.stop();
		this.metricsClient = null;
	}
}
