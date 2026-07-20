/**
 * Turns per-node facts + channel assignments into concrete render inputs:
 * radius, tint, glow alpha for every node.
 */
import { categoryColor, resolvePreset, sampleGradient } from "./colorScales";
import {
	computeMetric,
	isCategoricalMetric,
	normalizeValues,
	type MetricId,
	type NodeFacts,
	type NumericMetricId,
} from "./metrics";

export interface ChannelAssignment {
	size: NumericMetricId | null;
	color: MetricId | null;
	glow: NumericMetricId | null;
}

export interface NodeEncoding {
	sizes: Float32Array;
	/** Tint per node; -1 means "use theme default color". */
	tints: Int32Array;
	/** 0..1 glow intensity per node. */
	glow: Float32Array;
	/** Set for categorical color channels: category label per node. */
	categories: string[] | null;
}

export const MIN_RADIUS = 3;
export const MAX_RADIUS = 14;
const DEFAULT_RADIUS = 4;

/** Metrics with heavy tails get log normalization. */
const LOG_METRICS = new Set<MetricId>([
	"opens-total", "opens-90", "opens-30", "opens-7",
	"links-in", "links-out", "links-total", "file-size", "pagerank",
]);

function numericColumn(nodes: readonly NodeFacts[], metric: NumericMetricId, now: number): Float32Array {
	const raw = nodes.map((f) => computeMetric(metric, f, now) as number);
	return normalizeValues(raw, { log: LOG_METRICS.has(metric) });
}

export function buildEncoding(
	nodes: readonly NodeFacts[],
	channels: ChannelAssignment,
	colorPreset: string,
	now: number
): NodeEncoding {
	const count = nodes.length;
	const sizes = new Float32Array(count).fill(DEFAULT_RADIUS);
	const tints = new Int32Array(count).fill(-1);
	const glow = new Float32Array(count).fill(1);
	let categories: string[] | null = null;

	if (channels.size) {
		const values = numericColumn(nodes, channels.size, now);
		for (let i = 0; i < count; i++) {
			sizes[i] = MIN_RADIUS + values[i] * (MAX_RADIUS - MIN_RADIUS);
		}
	}

	if (channels.color) {
		const preset = resolvePreset(colorPreset);
		if (isCategoricalMetric(channels.color)) {
			categories = nodes.map((f) => String(computeMetric(channels.color!, f, now)));
			for (let i = 0; i < count; i++) {
				tints[i] = categories[i] ? categoryColor(categories[i], preset.categories) : -1;
			}
		} else {
			const stops = preset.stops;
			const values = numericColumn(nodes, channels.color, now);
			for (let i = 0; i < count; i++) {
				tints[i] = sampleGradient(stops, values[i]);
			}
		}
	}

	if (channels.glow) {
		const values = numericColumn(nodes, channels.glow, now);
		for (let i = 0; i < count; i++) {
			glow[i] = 0.35 + 0.65 * values[i];
		}
	}

	return { sizes, tints, glow, categories };
}
