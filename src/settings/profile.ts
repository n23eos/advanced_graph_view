/**
 * Settings profile: the part of the configuration that is worth moving between
 * vaults or machines. Usage history, saved positions and first-run state stay
 * behind — they describe one vault, not a way of working.
 */
import type { GraphInsightSettings } from "./schema";
import type { PanelState } from "../ui/ControlPanel";

/** Bump only on a breaking change: an older plugin refuses a newer profile. */
export const PROFILE_VERSION = 1;

export interface SettingsProfile {
	version: number;
	panel: PanelState;
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
		panel: isObject(profile.panel) ? { ...current.panel, ...profile.panel } : current.panel,
		viewPresets: Array.isArray(profile.viewPresets) ? profile.viewPresets : current.viewPresets,
		presets: Array.isArray(profile.presets) ? profile.presets : current.presets,
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
