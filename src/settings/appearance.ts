import type {
	FolderAppearanceOptions,
	LabelOptions,
	PanelState,
} from "../ui/ControlPanel";

export const DEFAULT_LABEL_APPEARANCE: Required<Pick<
	LabelOptions,
	"hoverOnly" | "hubs" | "fadeMs" | "rank"
>> = {
	hoverOnly: false,
	hubs: 8,
	fadeMs: 200,
	rank: "degree",
};

export const DEFAULT_EDGE_CURVATURE = 0.18;
export const DEFAULT_GLOW_INTENSITY = 1;
export const DEFAULT_FOLDER_APPEARANCE: FolderAppearanceOptions = {
	enabled: true,
	level: "top",
	overrides: {},
};

export type GraphAppearanceMode = "legacy" | "modern";

/** Only fields that change what a graph leaf draws. Layout forces and grouping
 * remain owned by the shared panel settings. */
export type GraphAppearancePanel = Pick<
	PanelState,
	| "channels"
	| "colorPreset"
	| "nodeStyle"
	| "overlays"
	| "showBubbles"
	| "showTimeline"
	| "showTrail"
	| "labels"
	| "edges"
	| "glowIntensity"
	| "folders"
	| "nodeScale"
	| "view3d"
>;

export interface GraphAppearance {
	version: 1;
	mode: GraphAppearanceMode;
	panel: GraphAppearancePanel;
}

export function createGraphAppearance(
	panel: PanelState,
	mode: GraphAppearanceMode
): GraphAppearance {
	return {
		version: 1,
		mode,
		panel: {
			channels: { ...panel.channels },
			colorPreset: panel.colorPreset,
			nodeStyle: panel.nodeStyle,
			overlays: { ...panel.overlays },
			showBubbles: panel.showBubbles,
			showTimeline: panel.showTimeline,
			showTrail: panel.showTrail,
			labels: { ...DEFAULT_LABEL_APPEARANCE, ...panel.labels },
			edges: {
				...panel.edges,
				curvature: panel.edges?.curvature ?? DEFAULT_EDGE_CURVATURE,
			},
			glowIntensity: panel.glowIntensity ?? DEFAULT_GLOW_INTENSITY,
			folders: {
				...DEFAULT_FOLDER_APPEARANCE,
				...panel.folders,
				overrides: normalizeFolderOverrides(panel.folders?.overrides),
			},
			nodeScale: panel.nodeScale,
			view3d: { ...panel.view3d },
		},
	};
}

export function normalizeFolderOverrides(raw: unknown): Record<string, string> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const overrides: Record<string, string> = {};
	for (const [rawFolder, color] of Object.entries(raw)) {
		const folder = rawFolder.trim();
		if (!folder || typeof color !== "string" || !isHexColor(color)) continue;
		overrides[folder] = color;
	}
	return overrides;
}

function isHexColor(value: string): boolean {
	return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
}

export function applyGraphAppearance(base: PanelState, appearance: GraphAppearance): PanelState {
	return {
		...base,
		...appearance.panel,
	};
}

export function isModernAppearance(appearance: GraphAppearance): boolean {
	return appearance.mode === "modern";
}

/** Renderer integration stays optional while the modern renderer lands in a
 * separate task. */
export function applyRendererAppearanceFlag(renderer: unknown, appearance: GraphAppearance, overview = false): void {
	if (!isAppearanceRenderer(renderer)) return;
	const modern = isModernAppearance(appearance);
	const { edges, labels, folders, glowIntensity } = appearance.panel;
	const hubs = labels.hubs ?? DEFAULT_LABEL_APPEARANCE.hubs;
	const curvature = edges.curvature ?? DEFAULT_EDGE_CURVATURE;
	renderer.setOverviewStyle?.(overview);
	if (overview) renderer.setModernAppearance(true, Math.min(curvature, 0.1), modern);
	else renderer.setModernAppearance(modern, curvature);
	renderer.setLabelPresentation?.(
		labels.hoverOnly ?? false,
		hubs,
		labels.fadeMs ?? DEFAULT_LABEL_APPEARANCE.fadeMs
	);
	renderer.setFolderPresentation?.(folders?.enabled ?? true, folders?.level ?? "top", folders?.overrides ?? {});
	renderer.setGlowIntensity?.(glowIntensity ?? DEFAULT_GLOW_INTENSITY);
}

function isAppearanceRenderer(
	value: unknown
): value is {
	setModernAppearance(enabled: boolean, curvature?: number, preferCoreHitRadius?: boolean): void;
	setOverviewStyle?(enabled: boolean): void;
	setLabelPresentation?(hoverOnly: boolean, hubs: number, fadeMs: number): void;
	setFolderPresentation?(enabled: boolean, level: "top" | "parent", colors: Readonly<Record<string, string>>): void;
	setGlowIntensity?(intensity: number): void;
} {
	return typeof value === "object"
		&& value !== null
		&& "setModernAppearance" in value
		&& typeof value.setModernAppearance === "function";
}
