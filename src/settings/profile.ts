/**
 * Settings profile: the part of the configuration that is worth moving between
 * vaults or machines. Usage history, saved positions and first-run state stay
 * behind — they describe one vault, not a way of working.
 */
import type { GraphInsightSettings } from "./schema";
import { normalizePanel, normalizeSearchPresets, normalizeViewPresets } from "./normalize";
import { PANEL_MODES, type PanelMode, type PanelState } from "../ui/ControlPanel";

/** Bump only on a breaking change: an older plugin refuses a newer profile. */
export const PROFILE_VERSION = 1;

export interface SettingsProfile {
	version: number;
	panel: PanelState;
	panelMode: PanelMode;
	viewPresets: GraphInsightSettings["viewPresets"];
	presets: GraphInsightSettings["presets"];
	openDwellSeconds: number;
	hoverPreview: GraphInsightSettings["hoverPreview"];
	chipFilter: GraphInsightSettings["chipFilter"];
	followActiveNote: boolean;
	openInSidePane: boolean;
}

export function buildProfile(settings: GraphInsightSettings): SettingsProfile {
	return {
		version: PROFILE_VERSION,
		panel: settings.panel,
		panelMode: settings.panelMode,
		viewPresets: settings.viewPresets,
		presets: settings.presets,
		openDwellSeconds: settings.openDwellSeconds,
		hoverPreview: settings.hoverPreview,
		chipFilter: settings.chipFilter,
		followActiveNote: settings.followActiveNote,
		openInSidePane: settings.openInSidePane,
	};
}

/**
 * Fold an imported profile into the current settings. Returns null when the
 * file is not a profile this version understands — better to say so than to
 * half-apply a file the user picked by mistake.
 */
export function mergeProfile(
	current: GraphInsightSettings,
	raw: unknown
): GraphInsightSettings | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const profile = raw as Partial<SettingsProfile>;
	if (typeof profile.version !== "number" || profile.version > PROFILE_VERSION) return null;

	return {
		...current,
		// normalizePanel/normalizeSearchPresets accept profiles written by
		// older versions: missing layoutRule, presets without id/timestamps.
		panel: isObject(profile.panel)
			? normalizePanel({ ...current.panel, ...profile.panel })
			: current.panel,
		panelMode: isPanelMode(profile.panelMode) ? profile.panelMode : current.panelMode,
		viewPresets: Array.isArray(profile.viewPresets)
			? normalizeViewPresets(profile.viewPresets)
			: current.viewPresets,
		presets: Array.isArray(profile.presets)
			? normalizeSearchPresets(profile.presets, Date.now())
			: current.presets,
		openDwellSeconds:
			typeof profile.openDwellSeconds === "number"
				? profile.openDwellSeconds
				: current.openDwellSeconds,
		hoverPreview: isObject(profile.hoverPreview)
			? { ...current.hoverPreview, ...profile.hoverPreview }
			: current.hoverPreview,
		chipFilter: isObject(profile.chipFilter)
			? { ...current.chipFilter, ...profile.chipFilter }
			: current.chipFilter,
		followActiveNote:
			typeof profile.followActiveNote === "boolean"
				? profile.followActiveNote
				: current.followActiveNote,
		openInSidePane:
			typeof profile.openInSidePane === "boolean"
				? profile.openInSidePane
				: current.openInSidePane,
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPanelMode(value: unknown): value is PanelMode {
	return typeof value === "string" && (PANEL_MODES as readonly string[]).includes(value);
}

