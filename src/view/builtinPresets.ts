/**
 * Bundled view presets: the panel snapshots the plugin ships with, plus the
 * seeding/retirement bookkeeping around them. Kept out of `main.ts` so the set
 * can be unit-tested without loading the Obsidian runtime.
 */
import type { PanelState } from "../ui/ControlPanel";
import type { BuiltinPresetId } from "./presetNames";


export interface ViewPreset {
	/** Literal name. For bundled presets this is the English original, kept so
	 *  older installs keep matching on it; the UI shows the translated name. */
	name: string;
	/** Set only on bundled presets: the locale key their display name comes
	 *  from. User presets have none and always show their literal name. */
	builtinId?: BuiltinPresetId;
	/** Full panel state snapshot: channels, colors, physics, 3D, layers. */
	panel: PanelState;
}

/** Fixed fields shared by every bundled panel snapshot, so each preset only
 *  spells out what actually differs. */
export type PanelSpec = Pick<
	PanelState,
	"channels" | "colorPreset" | "physics" | "labels" | "edges" | "nodeScale" | "view3d"
> & { showBubbles?: boolean; overlays?: Partial<PanelState["overlays"]> };

export function makePanel(spec: PanelSpec): PanelState {
	return {
		channels: spec.channels,
		colorPreset: spec.colorPreset,
		collapsed: false,
		overlays: { orphans: false, deadEnds: false, broken: false, ...spec.overlays },
		showBubbles: spec.showBubbles ?? false,
		showTimeline: false,
		showTrail: false,
		physics: spec.physics,
		labels: spec.labels,
		edges: spec.edges,
		nodeScale: spec.nodeScale,
		view3d: spec.view3d,
	};
}

/** The out-of-the-box view: a 3D galaxy. Also seeded as the "Default 3D" preset. */
export const DEFAULT_3D_PANEL = makePanel({
	channels: { size: "links-out", color: "cluster", glow: null },
	colorPreset: "galaxy",
	physics: {
		repel: 112, linkDistance: 205, centering: 0.245,
		linkStrength: 0.08, velocityDecay: 0.45, elasticity: 0.35, freeLayout: true, disabled: false,
	},
	labels: { show: true, fontSize: 11, zoomThreshold: 1.53, maxCount: 140, scaleWithZoom: true },
	edges: { show: true, width: 0.4, opacity: 0.21 },
	nodeScale: 1.2,
	view3d: { enabled: true, depthSource: "physics", focal: 900 },
});

/** Bump when DEFAULT_VIEW_PRESETS changes so existing installs re-seed. */
export const VIEW_PRESET_VERSION = 7;
/** Default preset names retired in newer versions — removed on migration. */
export const RETIRED_VIEW_PRESETS = new Set([
	"3D галактика", "Хабы и кластеры", "Недавнее", "Мелкие ноды",
	"Широкий разброс", "Плотный клубок", "Минимализм",
]);

/** Compact layout shared by the diagnostic presets — the same feel as the
 *  other 2D bundled presets, so switching between them doesn't relayout. */
const DIAGNOSTIC_PHYSICS: PanelState["physics"] = {
	repel: 30, linkDistance: 25, centering: 0.09,
	linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
};

/** Bundled presets, copied from the tuned Raincoat vault. "Default 3D" first —
 *  it matches the out-of-the-box panel. */
export const DEFAULT_VIEW_PRESETS: ViewPreset[] = [
	{ builtinId: "default-3d", name: "Default 3D", panel: DEFAULT_3D_PANEL },
	{
		builtinId: "default-2d",
		name: "Default 2D",
		panel: makePanel({
			channels: { size: "links-in", color: "cluster", glow: null },
			colorPreset: "galaxy",
			physics: {
				repel: 157, linkDistance: 90, centering: 0.355,
				linkStrength: 0.08, velocityDecay: 0.55, elasticity: 0.4, freeLayout: true,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 2.05,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "hubs-clusters",
		name: "Hubs and Clusters",
		panel: makePanel({
			channels: { size: "pagerank", color: "cluster", glow: "links-total" },
			colorPreset: "galaxy",
			showBubbles: true,
			physics: {
				repel: 30, linkDistance: 25, centering: 0.09,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 0.8,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "recent",
		name: "Recent",
		panel: makePanel({
			channels: { size: "opens-30", color: "recency-edit", glow: null },
			colorPreset: "heat",
			physics: {
				repel: 30, linkDistance: 25, centering: 0.09,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 1.25,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "wide-range",
		name: "Wide Range",
		panel: makePanel({
			channels: { size: "pagerank", color: "recency-edit", glow: null },
			colorPreset: "recency",
			physics: {
				repel: 158, linkDistance: 120, centering: 0.355,
				linkStrength: 0.08, velocityDecay: 0.55, elasticity: 0.4, freeLayout: true,
			},
			labels: { show: true, fontSize: 11, zoomThreshold: 0.73, maxCount: 40, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 2.5,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "density",
		name: "Density",
		panel: makePanel({
			channels: { size: "pagerank", color: "recency-edit", glow: null },
			colorPreset: "recency",
			physics: {
				repel: 5, linkDistance: 125, centering: 0.265,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.55, freeLayout: true,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.15, opacity: 0.18 },
			nodeScale: 0.95,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "small-nodes-2d",
		name: "Small Nodes 2D",
		panel: makePanel({
			channels: { size: "pagerank", color: "recency-edit", glow: null },
			colorPreset: "recency",
			physics: {
				repel: 30, linkDistance: 25, centering: 0.09,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
			},
			labels: { show: true, fontSize: 10, zoomThreshold: 1.78, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.15 },
			nodeScale: 0.55,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "minimalism",
		name: "Minimalism",
		panel: makePanel({
			channels: { size: "pagerank", color: "recency-edit", glow: null },
			colorPreset: "mono",
			physics: {
				repel: 30, linkDistance: 25, centering: 0.09,
				linkStrength: 0.15, velocityDecay: 0.55, elasticity: 0.4, freeLayout: false,
			},
			labels: { show: false, fontSize: 11, zoomThreshold: 0.9, maxCount: 100, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.16 },
			nodeScale: 1.25,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	// Diagnostic presets. Each turns on one overlay and drops the color scheme
	// to mono so the accent-glowed matches are the only thing that stands out;
	// labels are on because these views exist to be acted on, note by note.
	{
		builtinId: "orphans",
		name: "Orphans",
		panel: makePanel({
			// Size by file size: a big note nobody links to is the most lost work.
			channels: { size: "file-size", color: null, glow: null },
			colorPreset: "mono",
			overlays: { orphans: true },
			physics: DIAGNOSTIC_PHYSICS,
			labels: { show: true, fontSize: 11, zoomThreshold: 1.2, maxCount: 80, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.1 },
			nodeScale: 1.3,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "broken-links",
		name: "Broken links",
		panel: makePanel({
			channels: { size: "links-out", color: null, glow: null },
			colorPreset: "mono",
			overlays: { broken: true },
			physics: DIAGNOSTIC_PHYSICS,
			labels: { show: true, fontSize: 11, zoomThreshold: 1.2, maxCount: 80, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.1 },
			nodeScale: 1.3,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "dead-ends",
		name: "Dead ends",
		panel: makePanel({
			// Size by inbound links: a dead end many notes point at is the one
			// worth continuing first.
			channels: { size: "links-in", color: null, glow: null },
			colorPreset: "mono",
			overlays: { deadEnds: true },
			physics: DIAGNOSTIC_PHYSICS,
			labels: { show: true, fontSize: 11, zoomThreshold: 1.2, maxCount: 80, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.1 },
			nodeScale: 1.3,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
	{
		builtinId: "attention-map",
		name: "Attention map",
		// Size = structural importance, color = how much you actually opened it
		// in the last 90 days. Big and cold means a hub you have stopped reading.
		panel: makePanel({
			channels: { size: "pagerank", color: "opens-90", glow: null },
			colorPreset: "heat",
			physics: DIAGNOSTIC_PHYSICS,
			labels: { show: true, fontSize: 11, zoomThreshold: 1.1, maxCount: 60, scaleWithZoom: true },
			edges: { show: true, width: 0.2, opacity: 0.14 },
			nodeScale: 1.6,
			view3d: { enabled: false, depthSource: "physics", focal: 900 },
		}),
	},
];
