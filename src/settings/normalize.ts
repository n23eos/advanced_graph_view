import { normalizeGraphScope } from "../data/graphScope";
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
import {
	createGraphAppearance,
	DEFAULT_EDGE_CURVATURE,
	DEFAULT_FOLDER_APPEARANCE,
	DEFAULT_GLOW_INTENSITY,
	DEFAULT_LABEL_APPEARANCE,
	normalizeFolderOverrides,
	type GraphAppearance,
	type GraphAppearanceMode,
} from "./appearance";

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
		labels: normalizeLabelOptions(saved.labels, base.labels),
		edges: normalizeEdgeOptions(saved.edges, base.edges),
		glowIntensity: normalizeNumber(saved.glowIntensity, DEFAULT_GLOW_INTENSITY, 0, 3),
		folders: normalizeFolderAppearance(saved.folders),
		view3d: { ...base.view3d, ...asObject(saved.view3d) },
		nodeStyle: saved.nodeStyle === undefined
			? nodeStyleFromPreset(typeof saved.colorPreset === "string" ? saved.colorPreset : base.colorPreset)
			: isNodeStyle(saved.nodeStyle) ? saved.nodeStyle : base.nodeStyle,
		layoutRule: normalizeLayoutRule(saved.layoutRule),
	};
}

function normalizeLabelOptions(raw: unknown, base: PanelState["labels"]): PanelState["labels"] {
	const saved = asObject(raw);
	return {
		...base,
		...saved,
		hoverOnly: typeof saved.hoverOnly === "boolean"
			? saved.hoverOnly : DEFAULT_LABEL_APPEARANCE.hoverOnly,
		hubs: normalizeNumber(saved.hubs, DEFAULT_LABEL_APPEARANCE.hubs, 0, 64, true),
		fadeMs: normalizeNumber(saved.fadeMs, DEFAULT_LABEL_APPEARANCE.fadeMs, 0, 2000, true),
		rank: saved.rank === "degree" || saved.rank === "pagerank"
			? saved.rank : DEFAULT_LABEL_APPEARANCE.rank,
	};
}

function normalizeEdgeOptions(raw: unknown, base: PanelState["edges"]): PanelState["edges"] {
	const saved = asObject(raw);
	return {
		...base,
		...saved,
		curvature: normalizeNumber(saved.curvature, DEFAULT_EDGE_CURVATURE, 0, 1),
	};
}

function normalizeFolderAppearance(raw: unknown): NonNullable<PanelState["folders"]> {
	const saved = asObject(raw);
	return {
		enabled: typeof saved.enabled === "boolean" ? saved.enabled : DEFAULT_FOLDER_APPEARANCE.enabled,
		level: saved.level === "top" || saved.level === "parent"
			? saved.level : DEFAULT_FOLDER_APPEARANCE.level,
		overrides: normalizeFolderOverrides(saved.overrides),
	};
}

function normalizeNumber(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
	integer = false
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const clamped = Math.min(max, Math.max(min, value));
	return integer ? Math.round(clamped) : clamped;
}

export function normalizeGraphAppearance(
	raw: unknown,
	fallbackPanel: PanelState,
	fallbackMode?: GraphAppearanceMode
): GraphAppearance | null {
	if (!isObject(raw) || raw.version !== 1) {
		return fallbackMode ? createGraphAppearance(fallbackPanel, fallbackMode) : null;
	}
	const mode = raw.mode === "legacy" || raw.mode === "modern" ? raw.mode : fallbackMode;
	if (!mode) return null;
	const saved = asObject(raw.panel);
	const merged = normalizePanel({
		...fallbackPanel,
		...saved,
		channels: { ...fallbackPanel.channels, ...asObject(saved.channels) },
		overlays: { ...fallbackPanel.overlays, ...asObject(saved.overlays) },
		labels: { ...fallbackPanel.labels, ...asObject(saved.labels) },
		edges: { ...fallbackPanel.edges, ...asObject(saved.edges) },
		folders: { ...fallbackPanel.folders, ...asObject(saved.folders) },
		view3d: { ...fallbackPanel.view3d, ...asObject(saved.view3d) },
		// These shared fields are intentionally never accepted from a leaf.
		physics: fallbackPanel.physics,
		layoutRule: fallbackPanel.layoutRule,
	});
	return createGraphAppearance(merged, mode);
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
		const panel = normalizePanel(row.panel);
		presets.push({
			...(row as unknown as ViewPreset),
			panel,
			appearance: normalizeGraphAppearance(row.appearance, panel, "legacy")!,
		});
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

	const panel = normalizePanel(saved.panel);
	const appearance = normalizeGraphAppearance(
		saved.appearance,
		panel,
		isObject(raw) ? "legacy" : "modern"
	)!;

	return {
		...DEFAULT_SETTINGS,
		...rest,
		onboardingState,
		graphScope: normalizeGraphScope(saved.graphScope),
		renderScale: saved.renderScale === "high" ? "high" : "standard",
		physicsDefaultsVersion: typeof saved.physicsDefaultsVersion === "number" && Number.isFinite(saved.physicsDefaultsVersion)
			? saved.physicsDefaultsVersion : 0,
		panel,
		appearance,
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
