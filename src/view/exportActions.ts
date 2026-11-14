import { Notice, TFile, type App } from "obsidian";
import type { GraphModel } from "../data/GraphStore";
import type { GraphRenderer } from "../render/GraphRenderer";
import type { GraphMetrics } from "../workers/MetricsClient";
import { buildNeighborhood } from "../analysis/neighborhood";
import { graphToGexf, graphToJson } from "../export/exporters";
import { nextAvailableName, topicMapMarkdown, type TopicMapInput, type TopicMapSource } from "../export/topicMapMarkdown";
import { ExportConflictModal, TopicMapExportModal, type TopicMapExportDraft } from "../ui/TopicMapExportModal";
import { t } from "../i18n";

export interface ExportActionsDeps {
	getApp(): App;
	getRenderer(): GraphRenderer | null;
	getModel(): GraphModel | null;
	getMetrics(): GraphMetrics | null;
	getHiddenClusters(): ReadonlySet<number>;
	getFocusRootId(): number | null;
	getExploreFocus(): { centerId: number } | null;
	getFocusDepth(): number;
	getViewDocument(): Document | null;
	getViewWindow(): Window | null;
	getContentEl(): HTMLElement;
}

export class ExportActions {
	constructor(private readonly deps: ExportActionsDeps) {}

	private get app() { return this.deps.getApp(); }
	private get renderer() { return this.deps.getRenderer(); }
	private get model() { return this.deps.getModel(); }
	private get metrics() { return this.deps.getMetrics(); }
	private get hiddenClusters() { return this.deps.getHiddenClusters(); }
	private get focusRootId() { return this.deps.getFocusRootId(); }
	private get exploreFocus() { return this.deps.getExploreFocus(); }
	private get focusDepth() { return this.deps.getFocusDepth(); }
	private get viewDocument() { return this.deps.getViewDocument(); }
	private get viewWindow() { return this.deps.getViewWindow(); }
	private get contentEl() { return this.deps.getContentEl(); }

	private singleVisibleCluster(): number | null {
		if (!this.metrics || this.hiddenClusters.size === 0) return null;
		const visible: number[] = [];
		for (let c = 0; c < this.metrics.communityCount; c++) {
			if (!this.hiddenClusters.has(c)) visible.push(c);
		}
		return visible.length === 1 ? visible[0] : null;
	}

	canExportTopicMap(): boolean {
		return this.focusRootId !== null || this.exploreFocus !== null || this.singleVisibleCluster() !== null;
	}

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

	openTopicMapExport(
		source: TopicMapSource,
		rootId: number | null,
		flatIds: number[] = []
	): void {
		if (!this.model) return;
		const root = rootId !== null ? this.model.nodes[rootId] : null;
		new TopicMapExportModal(
			this.app,
			{
				name: root ? `${t("topicmap.modalTitle")} \u2014 ${root.name}` : t("topicmap.modalTitle"),
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

	async exportPngFile(): Promise<void> {
		const blob = await this.renderer?.exportPng();
		if (!blob) {
			new Notice(t("notice.pngFailed"));
			return;
		}
		this.downloadBlob("graph-insight.png", blob);
	}

	exportJsonFile(): void {
		if (!this.model) return;
		this.downloadBlob("graph-insight.json", new Blob([graphToJson(this.model)], { type: "application/json" }));
	}

	exportGexfFile(): void {
		if (!this.model) return;
		this.downloadBlob("graph-insight.gexf", new Blob([graphToGexf(this.model)], { type: "application/xml" }));
	}

	private downloadBlob(fileName: string, blob: Blob): void {
		const doc = this.viewDocument ?? this.contentEl.ownerDocument;
		const ownerWindow = this.viewWindow ?? doc.defaultView;
		if (ownerWindow) downloadBlob(fileName, blob, doc, ownerWindow);
	}
}

function downloadBlob(fileName: string, blob: Blob, doc: Document, ownerWindow: Window): void {
	const hostUrl = (ownerWindow as Window & typeof window).URL;
	const url = hostUrl.createObjectURL(blob);
	const anchor = doc.body.createEl("a", { attr: { href: url, download: fileName } });
	anchor.click();
	anchor.remove();
	hostUrl.revokeObjectURL(url);
}
