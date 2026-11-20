/**
 * Turns per-node facts + channel assignments into concrete render inputs:
 * radius, tint, glow alpha for every node.
 */
import { categoryColor, resolvePreset, sampleGradient } from "./colorScales";
import { adaptPresetToTheme } from "./themeContrast";
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
	now: number,
	/** Light themes need the brightest scheme colors dimmed to stay visible. */
	isLightTheme = false,
	folders?: { level: "top" | "parent"; overrides: Readonly<Record<string, string>> }
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
		const preset = adaptPresetToTheme(resolvePreset(colorPreset), isLightTheme);
		if (isCategoricalMetric(channels.color)) {
			categories = nodes.map((f) => {
				const category = String(computeMetric(channels.color!, f, now));
				return channels.color === "folder" && folders?.level === "top" ? category.split("/")[0] : category;
			});
			for (let i = 0; i < count; i++) {
				const category = categories[i];
				const override = channels.color === "folder" && folders && Object.hasOwn(folders.overrides, category)
					? folders.overrides[category] : undefined;
				tints[i] = !category ? -1 : override ? hexToRgb(override) : categoryColor(category, preset.categories);
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

function hexToRgb(color: string): number {
	const digits = color.slice(1, color.length <= 5 ? 4 : 7);
	const rgb = digits.length === 3 ? Array.from(digits, (digit) => digit + digit).join("") : digits;
	return Number.parseInt(rgb, 16);
}
