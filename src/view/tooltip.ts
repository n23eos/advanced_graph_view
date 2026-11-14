import { nodeDisplayPath } from "../data/graphNodes";
import { TFile, type App } from "obsidian";
import type { GraphModel } from "../data/GraphStore";
import type { NodeFacts } from "../encoding/metrics";
import type { GraphInsightSettings } from "../settings/schema";
import { metricLabel } from "../encoding/metricLabels";
import { stripFrontmatter, stripMarkdown } from "../data/stripMarkdown";
import { t } from "../i18n";

export interface TooltipControllerDeps {
	getApp(): Pick<App, "vault">;
	getContentEl(): HTMLElement;
	getFacts(): NodeFacts[];
	getModel(): GraphModel | null;
	getOpenGeneration(): number;
	getPlugin(): { settings: Pick<GraphInsightSettings, "panel" | "hoverPreview"> };
	getPreviewTimer(): number | null;
	setPreviewTimer(value: number | null): void;
	getTooltip(): HTMLElement | null;
	setTooltip(value: HTMLElement | null): void;
	getTooltipNodeId(): number | null;
	setTooltipNodeId(value: number | null): void;
	getViewWindow(): Window | null;
	clearPreviewTimer(): void;
	appendNotePreview(nodeId: number, words: number): Promise<void>;
	notePreview(nodeId: number, words: number): Promise<string | null>;
}

export class TooltipController {
	constructor(private readonly deps: TooltipControllerDeps) {}

	private get app() { return this.deps.getApp(); }
	private get contentEl() { return this.deps.getContentEl(); }
	private get facts() { return this.deps.getFacts(); }
	private get model() { return this.deps.getModel(); }
	private get openGeneration() { return this.deps.getOpenGeneration(); }
	private get plugin() { return this.deps.getPlugin(); }
	private get previewTimer() { return this.deps.getPreviewTimer(); }
	private set previewTimer(value: number | null) { this.deps.setPreviewTimer(value); }
	private get tooltip() { return this.deps.getTooltip(); }
	private set tooltip(value: HTMLElement | null) { this.deps.setTooltip(value); }
	private get tooltipNodeId() { return this.deps.getTooltipNodeId(); }
	private set tooltipNodeId(value: number | null) { this.deps.setTooltipNodeId(value); }
	private get viewWindow() { return this.deps.getViewWindow(); }

	showTooltip(nodeId: number | null, clientX: number, clientY: number): void {
		if (!this.tooltip || !this.model) return;
		if (nodeId === null) {
			this.tooltipNodeId = null;
			this.deps.clearPreviewTimer();
			this.tooltip.hide();
			return;
		}
		// The tooltip trails the cursor on every move, but only its position.
		const rect = this.contentEl.getBoundingClientRect();
		this.tooltip.style.left = `${clientX - rect.left + 12}px`;
		this.tooltip.style.top = `${clientY - rect.top + 12}px`;
		// Same node: don't rebuild or re-read \u2014 that would cancel the pending
		// preview read on every micro-movement of the mouse.
		if (nodeId === this.tooltipNodeId) return;
		this.tooltipNodeId = nodeId;
		this.deps.clearPreviewTimer();

		const node = this.model.nodes[nodeId];
		const facts = this.facts[nodeId];
		this.tooltip.empty();
		this.tooltip.createDiv({ cls: "graph-insight-tooltip-title", text: node.kind === "unresolved" ? nodeDisplayPath(node) : node.name });
		if (facts) {
			const meta = this.tooltip.createDiv({ cls: "graph-insight-tooltip-meta" });
			meta.createDiv({
				text: t("tooltip.opens", { total: facts.opensTotal, recent: facts.opens30 }),
			});
			meta.createDiv({
				text: t("tooltip.links", { inbound: facts.inCount, outbound: facts.outCount }),
			});
			if (node.kind !== "unresolved") meta.createDiv({
				text: t("tooltip.edited", { date: new Date(facts.mtime).toLocaleDateString() }),
			});
			const channels = this.plugin.settings.panel.channels;
			const encoding = this.tooltip.createDiv({ cls: "graph-insight-tooltip-encoding" });
			if (channels.size) encoding.createSpan({ text: `${t("appearance.size")}: ${metricLabel(channels.size)}` });
			if (channels.color) encoding.createSpan({ text: `${t("appearance.color")}: ${metricLabel(channels.color)}` });
		}
		this.tooltip.show();

		const preview = this.plugin.settings.hoverPreview;
		if (preview.enabled) {
			const viewWindow = this.viewWindow;
			if (!viewWindow) return;
			const generation = this.openGeneration;
			// Only load once the cursor has settled on this node, so sweeping
			// across a dense cluster doesn't fire a read per node.
			this.previewTimer = viewWindow.setTimeout(() => {
				if (generation !== this.openGeneration) return;
				this.previewTimer = null;
				if (nodeId === this.tooltipNodeId) void this.deps.appendNotePreview(nodeId, preview.words);
			}, Math.max(0, preview.delayMs));
		}
	}

	clearPreviewTimer(): void {
		if (this.previewTimer !== null) {
			this.viewWindow?.clearTimeout(this.previewTimer);
			this.previewTimer = null;
		}
	}

	async appendNotePreview(nodeId: number, words: number): Promise<void> {
		const generation = this.openGeneration;
		const tooltip = this.tooltip;
		const text = await this.deps.notePreview(nodeId, words);
		if (generation !== this.openGeneration || tooltip !== this.tooltip ||
			nodeId !== this.tooltipNodeId || !tooltip || !text) return;
		tooltip.createDiv({ cls: "graph-insight-tooltip-preview", text });
	}

	async notePreview(nodeId: number, words: number): Promise<string | null> {
		const node = this.model?.nodes[nodeId];
		if (!node || node.kind === "unresolved" || node.path.includes("\0")) return null;
		const file = this.app.vault.getAbstractFileByPath(node.path);
		if (!(file instanceof TFile) || file.extension !== "md") return null;
		let raw = "";
		try {
			raw = await this.app.vault.cachedRead(file);
		} catch {
			return null;
		}
		const body = stripMarkdown(stripFrontmatter(raw))
			.replace(/\s+/g, " ")
			.trim();
		if (!body) return null;
		return body.split(" ").slice(0, words).join(" ");
	}
}
