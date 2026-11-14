/**
 * Node metric extraction for visual channels. Pure functions: GraphView
 * assembles NodeFacts from vault data, this module turns facts into values.
 */

export interface NodeFacts {
	kind?: "note" | "attachment" | "unresolved";
	path: string;
	folder: string;
	tags: string[];
	inCount: number;
	outCount: number;
	unresolvedCount: number;
	ctime: number;
	mtime: number;
	size: number;
	opensTotal: number;
	/** Filled from the metrics worker once computed; 0 until then. */
	pagerank: number;
	/** Cluster display name; empty until communities are computed. */
	cluster: string;
	opens7: number;
	opens30: number;
	opens90: number;
	/** Normalized frontmatter values, absent for legacy and non-vault facts. */
	properties?: Readonly<Record<string, readonly string[]>>;
}

export type NumericMetricId =
	| "opens-total"
	| "opens-90"
	| "opens-30"
	| "opens-7"
	| "recency-edit"
	| "age-created"
	| "links-in"
	| "links-out"
	| "links-total"
	| "file-size"
	| "pagerank";

export type PropertyMetricId = `prop:${string}`;

export type CategoricalMetricId = "folder" | "tag" | "cluster" | PropertyMetricId;

export type MetricId = NumericMetricId | CategoricalMetricId;

/** Display order in the channel dropdowns. Labels live in the locale files —
 *  see `metricLabels.ts`. */
export const NUMERIC_METRIC_IDS: readonly NumericMetricId[] = [
	"opens-total",
	"opens-90",
	"opens-30",
	"opens-7",
	"recency-edit",
	"age-created",
	"links-in",
	"links-out",
	"links-total",
	"file-size",
	"pagerank",
];

export const CATEGORICAL_METRIC_IDS: readonly CategoricalMetricId[] = ["folder", "tag", "cluster"];

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeMetric(metric: MetricId, facts: NodeFacts, now: number): number | string {
	const propertyKey = propertyKeyFromMetric(metric);
	if (propertyKey !== null) return facts.properties?.[propertyKey]?.[0] ?? "";
	if (facts.kind === "unresolved" && (metric === "recency-edit" || metric === "age-created")) return 0;
	switch (metric) {
		case "opens-total": return facts.opensTotal;
		case "opens-90": return facts.opens90;
		case "opens-30": return facts.opens30;
		case "opens-7": return facts.opens7;
		// Days since edit, negated so "fresher" is a larger value.
		case "recency-edit": return -((now - facts.mtime) / DAY_MS);
		case "age-created": return (now - facts.ctime) / DAY_MS;
		case "links-in": return facts.inCount;
		case "links-out": return facts.outCount;
		case "links-total": return facts.inCount + facts.outCount;
		case "file-size": return facts.size;
		case "pagerank": return facts.pagerank;
		case "folder": return facts.folder;
		case "tag": return facts.tags[0] ?? "";
		case "cluster": return facts.cluster;
		default: return "";
	}
}

export function isCategoricalMetric(metric: MetricId): metric is CategoricalMetricId {
	return metric === "folder" || metric === "tag" || metric === "cluster" || isPropertyMetricId(metric);
}

export function isNumericMetricId(value: unknown): value is NumericMetricId {
	return typeof value === "string" && (NUMERIC_METRIC_IDS as readonly string[]).includes(value);
}

export function propertyMetricId(key: string): PropertyMetricId {
	return `prop:${key.trim().toLowerCase()}`;
}

export function isPropertyMetricId(value: unknown): value is PropertyMetricId {
	if (typeof value !== "string" || !value.startsWith("prop:")) return false;
	const key = value.slice("prop:".length);
	return key.length > 0 && key === key.trim().toLowerCase();
}

export function propertyKeyFromMetric(metric: string): string | null {
	return isPropertyMetricId(metric) ? metric.slice("prop:".length) : null;
}

/**
 * Normalize raw values to 0..1. Log mode is for heavy-tailed metrics
 * (opens, links, size) so one huge hub doesn't flatten everything else.
 */
export function normalizeValues(values: readonly number[], options?: { log?: boolean }): Float32Array {
	const result = new Float32Array(values.length);
	if (values.length === 0) return result;

	const transform = options?.log
		? (v: number) => Math.log1p(Math.max(0, v))
		: (v: number) => v;

	let min = Infinity;
	let max = -Infinity;
	for (const value of values) {
		const t = transform(value);
		if (t < min) min = t;
		if (t > max) max = t;
	}

	const range = max - min;
	for (let i = 0; i < values.length; i++) {
		result[i] = range === 0 ? 0.5 : (transform(values[i]) - min) / range;
	}
	return result;
}
