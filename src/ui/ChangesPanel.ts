/**
 * F-10: the "What changed?" panel inside the graph view. Pure DOM — the host
 * computes the data (worker for big graphs) and owns the masks; the panel
 * renders periods, category counts and the selected category's rows.
 */
import { t } from "../i18n";
import type { ChangeCategory, LinkChange } from "../analysis/graphChanges";

export interface ClusterRef {
	id: number;
	label: string;
}

export interface ChangesData {
	/** False when no snapshot reaches the period start — link and hub
	 *  categories degrade to an empty state, the rest keep working. */
	hasHistory: boolean;
	/** False without metrics: hubs/clusters categories are unavailable. */
	hasMetrics: boolean;
	newNotes: string[];
	editedNotes: string[];
	addedLinks: LinkChange[];
	removedLinks: LinkChange[];
	growingHubs: string[];
	coolingClusters: ClusterRef[];
}

export interface ChangesPanelCallbacks {
	onPeriodChange(days: 7 | 30): void;
	onCategorySelect(category: ChangeCategory | null): void;
	onOpenNote(path: string): void;
	onFocusLink(link: LinkChange): void;
	onFocusCluster(id: number): void;
	onClose(): void;
}

/** DOM stays readable on huge vaults: rows past this render as "+N more". */
const ROW_LIMIT = 100;

const HISTORY_CATEGORIES: ReadonlySet<ChangeCategory> = new Set(["added-links", "removed-links", "growing-hubs"]);
const METRIC_CATEGORIES: ReadonlySet<ChangeCategory> = new Set(["growing-hubs", "cooling-clusters"]);

export class ChangesPanel {
	private root: HTMLElement;
	private body: HTMLElement;
	private periodDays: 7 | 30 = 7;
	private selected: ChangeCategory | null = null;
	private data: ChangesData | null = null;
	private loading = false;

	constructor(host: HTMLElement, private readonly callbacks: ChangesPanelCallbacks) {
		this.root = host.createDiv({ cls: "graph-insight-changes" });
		const header = this.root.createDiv({ cls: "graph-insight-changes-header" });
		header.createSpan({ text: t("changes.title") });
		const close = header.createEl("button", { text: "✕", cls: "graph-insight-searchbar-btn" });
		close.setAttribute("aria-label", t("preset.cancel"));
		close.addEventListener("click", () => this.callbacks.onClose());
		this.body = this.root.createDiv({ cls: "graph-insight-changes-body" });
		this.render();
	}

	setState(periodDays: 7 | 30, selected: ChangeCategory | null): void {
		this.periodDays = periodDays;
		this.selected = selected;
		this.render();
	}

	/** null data = skeleton while the diff computes. */
	setData(data: ChangesData | null): void {
		this.data = data;
		this.loading = data === null;
		this.render();
	}

	show(): void {
		this.root.show();
	}

	hide(): void {
		this.root.hide();
	}

	get isShown(): boolean {
		return this.root.isShown();
	}

	destroy(): void {
		this.root.remove();
	}

	private counts(): Array<{ category: ChangeCategory; label: string; count: number; available: boolean }> {
		const d = this.data;
		const row = (category: ChangeCategory, label: string, count: number) => ({
			category,
			label,
			count,
			available:
				(!HISTORY_CATEGORIES.has(category) || (d?.hasHistory ?? false)) &&
				(!METRIC_CATEGORIES.has(category) || (d?.hasMetrics ?? false)),
		});
		return [
			row("new-notes", t("changes.cat.newNotes"), d?.newNotes.length ?? 0),
			row("edited-notes", t("changes.cat.editedNotes"), d?.editedNotes.length ?? 0),
			row("added-links", t("changes.cat.addedLinks"), d?.addedLinks.length ?? 0),
			row("removed-links", t("changes.cat.removedLinks"), d?.removedLinks.length ?? 0),
			row("growing-hubs", t("changes.cat.growingHubs"), d?.growingHubs.length ?? 0),
			row("cooling-clusters", t("changes.cat.coolingClusters"), d?.coolingClusters.length ?? 0),
		];
	}

	private render(): void {
		this.body.empty();

		const periods = this.body.createDiv({ cls: "graph-insight-changes-periods" });
		for (const days of [7, 30] as const) {
			const button = periods.createEl("button", {
				text: t(days === 7 ? "changes.period7" : "changes.period30"),
				cls: "graph-insight-panel-mode",
			});
			button.toggleClass("is-active", this.periodDays === days);
			button.addEventListener("click", () => this.callbacks.onPeriodChange(days));
		}
		const reset = periods.createEl("button", { text: t("changes.reset"), cls: "graph-insight-panel-mode" });
		reset.addEventListener("click", () => this.callbacks.onCategorySelect(null));

		if (this.loading) {
			this.body.createDiv({ cls: "graph-insight-changes-skeleton", text: t("changes.loading") });
			return;
		}

		for (const { category, label, count, available } of this.counts()) {
			const row = this.body.createEl("button", { cls: "graph-insight-changes-category" });
			row.toggleClass("is-active", this.selected === category);
			row.disabled = !available;
			row.createSpan({ text: label });
			row.createSpan({ cls: "graph-insight-panel-count", text: available ? String(count) : "—" });
			row.addEventListener("click", () => this.callbacks.onCategorySelect(category));
		}

		if (this.data && !this.data.hasHistory) {
			this.body.createDiv({ cls: "graph-insight-changes-empty", text: t("changes.empty") });
		}

		if (this.selected && this.data) this.renderRows(this.selected, this.data);
	}

	private renderRows(category: ChangeCategory, data: ChangesData): void {
		const list = this.body.createDiv({ cls: "graph-insight-changes-list" });
		const noteRow = (path: string) => {
			const row = list.createEl("button", { cls: "graph-insight-changes-row", text: displayName(path) });
			row.addEventListener("click", () => this.callbacks.onOpenNote(path));
		};
		const linkRow = (link: LinkChange) => {
			const row = list.createEl("button", {
				cls: "graph-insight-changes-row",
				text: `${displayName(link.fromPath)} → ${displayName(link.toPath)}`,
			});
			row.addEventListener("click", () => this.callbacks.onFocusLink(link));
		};

		const items: Array<() => void> = [];
		switch (category) {
			case "new-notes": data.newNotes.forEach((p) => items.push(() => noteRow(p))); break;
			case "edited-notes": data.editedNotes.forEach((p) => items.push(() => noteRow(p))); break;
			case "growing-hubs": data.growingHubs.forEach((p) => items.push(() => noteRow(p))); break;
			case "added-links": data.addedLinks.forEach((l) => items.push(() => linkRow(l))); break;
			case "removed-links": data.removedLinks.forEach((l) => items.push(() => linkRow(l))); break;
			case "cooling-clusters":
				data.coolingClusters.forEach((cluster) =>
					items.push(() => {
						const row = list.createEl("button", { cls: "graph-insight-changes-row", text: cluster.label });
						row.addEventListener("click", () => this.callbacks.onFocusCluster(cluster.id));
					})
				);
				break;
		}
		items.slice(0, ROW_LIMIT).forEach((render) => render());
		if (items.length > ROW_LIMIT) {
			list.createDiv({
				cls: "graph-insight-changes-more",
				text: t("changes.more", { count: String(items.length - ROW_LIMIT) }),
			});
		}
	}
}

function displayName(path: string): string {
	const base = path.slice(path.lastIndexOf("/") + 1);
	return base.replace(/\.md$/, "");
}
