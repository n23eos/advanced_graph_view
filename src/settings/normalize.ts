/**
 * Turns whatever an older version (or a hand-edited file) left in data.json
 * into the current GraphInsightSettings shape. Pure, so every migration path
 * is unit-testable without the Obsidian runtime.
 */
import type { GraphInsightSettings, OnboardingState, SearchPreset } from "./schema";
import { DEFAULT_SETTINGS, ONBOARDING_STATES } from "./schema";
import type { PanelState } from "../ui/ControlPanel";
import type { LayoutRule } from "../workers/layoutEngine";
import type { ViewPreset } from "../view/builtinPresets";
import { isNodeStyle, nodeStyleFromPreset } from "../render/nodeStyle";
import {
	isCategoricalMetric,
	isNumericMetricId,
	isPropertyMetricId,
	type MetricId,
	type NumericMetricId,
} from "../encoding/metrics";

const LAYOUT_RULES: readonly LayoutRule[] = [
	"links", "tags", "folders", "cluster", "age", "recency", "hubs",
];

export function isLayoutRule(value: unknown): value is LayoutRule {
	return typeof value === "string" && (LAYOUT_RULES as readonly string[]).includes(value);
}

/** Unknown or missing rules fall back to the default rather than rejecting
 *  the whole payload. */
export function normalizeLayoutRule(value: unknown): LayoutRule {
	return isLayoutRule(value) ? value : "links";
}

/** Deep-merge a saved panel over the defaults so panels written by older
 *  versions pick up newly added fields. */
export function normalizePanel(raw: unknown): PanelState {
	const saved = asObject(raw) as Partial<PanelState>;
	const base = DEFAULT_SETTINGS.panel;
	const savedChannels = asObject(saved.channels);
	return {
		...base,
		...saved,
		channels: {
			size: normalizeNumericChannel(savedChannels.size, base.channels.size),
			color: normalizeColorChannel(savedChannels.color, base.channels.color),
			glow: normalizeNumericChannel(savedChannels.glow, base.channels.glow),
		},
		overlays: { ...base.overlays, ...asObject(saved.overlays) },
		physics: { ...base.physics, ...asObject(saved.physics) },
		labels: { ...base.labels, ...asObject(saved.labels) },
		edges: { ...base.edges, ...asObject(saved.edges) },
		view3d: { ...base.view3d, ...asObject(saved.view3d) },
		nodeStyle: saved.nodeStyle === undefined
			? nodeStyleFromPreset(typeof saved.colorPreset === "string" ? saved.colorPreset : base.colorPreset)
			: isNodeStyle(saved.nodeStyle) ? saved.nodeStyle : base.nodeStyle,
		layoutRule: normalizeLayoutRule(saved.layoutRule),
	};
}

function normalizeNumericChannel(value: unknown, fallback: NumericMetricId | null): NumericMetricId | null {
	return value === null || isNumericMetricId(value) ? value : fallback;
}

function normalizeColorChannel(value: unknown, fallback: MetricId | null): MetricId | null {
	if (value === null || isNumericMetricId(value)) return value;
	if (typeof value === "string" && (isCategoricalMetric(value as MetricId) || isPropertyMetricId(value))) {
		return value as MetricId;
	}
	return fallback;
}

/** Backfill id and timestamps on legacy { name, query } rows, drop anything
 *  that is not a preset, and make sure no two presets share an id. */
export function normalizeSearchPresets(raw: unknown, now: number): SearchPreset[] {
	if (!Array.isArray(raw)) return [];
	const seenIds = new Set<string>();
	const presets: SearchPreset[] = [];
	for (const row of raw) {
		if (!isObject(row) || typeof row.name !== "string" || typeof row.query !== "string") continue;
		const savedId = typeof row.id === "string" && row.id.length > 0 ? row.id : null;
		const id = savedId === null || seenIds.has(savedId) ? crypto.randomUUID() : savedId;
		seenIds.add(id);
		presets.push({
			id,
			name: row.name,
			query: row.query,
			createdAt: typeof row.createdAt === "number" ? row.createdAt : now,
			updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : now,
			...(typeof row.lastUsedAt === "number" ? { lastUsedAt: row.lastUsedAt } : {}),
		});
	}
	return presets;
}

export function normalizeViewPresets(raw: unknown): ViewPreset[] {
	if (!Array.isArray(raw)) return [];
	const presets: ViewPreset[] = [];
	for (const row of raw) {
		if (!isObject(row) || typeof row.name !== "string" || !isObject(row.panel)) continue;
		presets.push({ ...(row as unknown as ViewPreset), panel: normalizePanel(row.panel) });
	}
	return presets;
}

function normalizeOnboardingState(saved: Record<string, unknown>): OnboardingState {
	const state = saved.onboardingState;
	if (typeof state === "string" && (ONBOARDING_STATES as readonly string[]).includes(state)) {
		return state as OnboardingState;
	}
	// Legacy boolean: true meant "shown once, never show again".
	return saved.onboardingShown === true ? "disabled" : "never-seen";
}

export function normalizeSettings(raw: unknown, now: number = Date.now()): GraphInsightSettings {
	const saved = isObject(raw) ? raw : {};
	const onboardingState = normalizeOnboardingState(saved);
	// The legacy flag is read above but never carried forward or written again.
	const rest = { ...saved } as Partial<GraphInsightSettings> & { onboardingShown?: unknown };
	delete rest.onboardingShown;
	delete rest.onboardingState;

	return {
		...DEFAULT_SETTINGS,
		...rest,
		onboardingState,
		renderScale: saved.renderScale === "high" ? "high" : "standard",
		physicsDefaultsVersion: typeof saved.physicsDefaultsVersion === "number" && Number.isFinite(saved.physicsDefaultsVersion)
			? saved.physicsDefaultsVersion : 0,
		panel: normalizePanel(saved.panel),
		presets: normalizeSearchPresets(saved.presets, now),
		viewPresets: normalizeViewPresets(saved.viewPresets),
		hoverPreview: { ...DEFAULT_SETTINGS.hoverPreview, ...asObject(saved.hoverPreview) },
		chipFilter: { ...DEFAULT_SETTINGS.chipFilter, ...asObject(saved.chipFilter) },
		localGraph: { ...DEFAULT_SETTINGS.localGraph, ...asObject(saved.localGraph) },
		collapsedSections: { ...DEFAULT_SETTINGS.collapsedSections, ...asObject(saved.collapsedSections) },
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> {
	return isObject(value) ? value : {};
}

export const PHYSICS_DEFAULTS_VERSION = 1;

/** Upgrade old defaults once; subsequent slider choices belong to the user. */
export function migratePhysicsDefaults(settings: GraphInsightSettings): GraphInsightSettings {
	if (settings.physicsDefaultsVersion >= PHYSICS_DEFAULTS_VERSION) return settings;
	const physics = settings.panel.physics;
	return {
		...settings,
		physicsDefaultsVersion: PHYSICS_DEFAULTS_VERSION,
		panel: {
			...settings.panel,
			physics: {
				...physics,
				linkStrength: physics.linkStrength === 0.4 ? 0.15 : physics.linkStrength,
				velocityDecay: physics.velocityDecay === 0.4 ? 0.55 : physics.velocityDecay,
				repel: physics.repel === 50 || physics.repel === 40 ? 30 : physics.repel,
				linkDistance: physics.linkDistance === 40 ? 25 : physics.linkDistance,
				centering: physics.centering === 0.04 || physics.centering === 0.05 ? 0.09 : physics.centering,
			},
		},
	};
}
