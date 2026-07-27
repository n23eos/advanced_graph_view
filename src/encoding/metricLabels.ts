/**
 * Display names for metrics and color schemes. Split out from `metrics.ts` and
 * `colorScales.ts` so those stay pure data and the UI has one place to ask for
 * a translated label.
 */
import { t, type TranslationKey } from "../i18n";
import { SCALE_PRESETS } from "./colorScales";
import { CATEGORICAL_METRIC_IDS, NUMERIC_METRIC_IDS, type MetricId } from "./metrics";

export function metricLabel(metric: MetricId): string {
	return t(`metric.${metric}` as TranslationKey);
}

export function scaleLabel(presetId: string): string {
	return t(`scale.${presetId}` as TranslationKey);
}

/** `{ id: label }` maps for the channel dropdowns, in display order. */
export function numericMetricOptions(): Record<string, string> {
	return Object.fromEntries(NUMERIC_METRIC_IDS.map((id) => [id, metricLabel(id)]));
}

export function categoricalMetricOptions(): Record<string, string> {
	return Object.fromEntries(CATEGORICAL_METRIC_IDS.map((id) => [id, metricLabel(id)]));
}

export function scaleOptions(): Record<string, string> {
	return Object.fromEntries(Object.keys(SCALE_PRESETS).map((id) => [id, scaleLabel(id)]));
}
