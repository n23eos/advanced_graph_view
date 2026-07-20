/**
 * Legend chip in the bottom-right corner: gradient bar for numeric color
 * channels, category swatches for folder/tag coloring.
 */
import { categoryColor, resolvePreset } from "../encoding/colorScales";
import {
	CATEGORICAL_METRIC_LABELS,
	NUMERIC_METRIC_LABELS,
	isCategoricalMetric,
	type MetricId,
} from "../encoding/metrics";

const MAX_LEGEND_CATEGORIES = 8;

function toHex(color: number): string {
	return `#${color.toString(16).padStart(6, "0")}`;
}

export class Legend {
	private root: HTMLElement;

	constructor(host: HTMLElement) {
		this.root = host.createDiv({ cls: "graph-insight-legend" });
		this.root.hide();
	}

	update(colorMetric: MetricId | null, presetId: string, categories: string[] | null): void {
		this.root.empty();
		if (!colorMetric) {
			this.root.hide();
			return;
		}
		this.root.show();

		if (isCategoricalMetric(colorMetric) && categories) {
			this.renderCategories(colorMetric, categories, presetId);
		} else {
			this.renderGradient(colorMetric, presetId);
		}
	}

	private renderGradient(metric: MetricId, presetId: string): void {
		const preset = resolvePreset(presetId);
		this.root.createDiv({
			cls: "graph-insight-legend-title",
			text: NUMERIC_METRIC_LABELS[metric as keyof typeof NUMERIC_METRIC_LABELS] ?? metric,
		});
		const bar = this.root.createDiv({ cls: "graph-insight-legend-bar" });
		bar.style.background = `linear-gradient(to right, ${preset.stops.map(toHex).join(", ")})`;
		const range = this.root.createDiv({ cls: "graph-insight-legend-range" });
		range.createSpan({ text: "min" });
		range.createSpan({ text: "max" });
	}

	private renderCategories(metric: MetricId, categories: string[], presetId: string): void {
		const palette = resolvePreset(presetId).categories;
		this.root.createDiv({
			cls: "graph-insight-legend-title",
			text: CATEGORICAL_METRIC_LABELS[metric as keyof typeof CATEGORICAL_METRIC_LABELS] ?? metric,
		});

		const counts = new Map<string, number>();
		for (const category of categories) {
			if (!category) continue;
			counts.set(category, (counts.get(category) ?? 0) + 1);
		}
		const top = [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, MAX_LEGEND_CATEGORIES);

		for (const [category] of top) {
			const row = this.root.createDiv({ cls: "graph-insight-legend-category" });
			const swatch = row.createSpan({ cls: "graph-insight-legend-swatch" });
			swatch.style.background = toHex(categoryColor(category, palette));
			row.createSpan({ text: category });
		}
		const rest = counts.size - top.length;
		if (rest > 0) {
			this.root.createDiv({ cls: "graph-insight-legend-more", text: `and ${rest} more…` });
		}
	}

	destroy(): void {
		this.root.remove();
	}
}
