/**
 * Naming and migration for view presets. Bundled presets are addressed by a
 * stable id so their label can be translated without touching what is stored in
 * the user's data.json; user presets are left exactly as they were saved.
 */
import { en } from "../i18n/locales/en";
import { t, type TranslationKey } from "../i18n";

/** Ids of the bundled presets — the `preset.*` keys, minus the prefix. */
export type BuiltinPresetId =
	| "default-3d"
	| "default-2d"
	| "hubs-clusters"
	| "recent"
	| "wide-range"
	| "density"
	| "small-nodes-2d"
	| "minimalism"
	| "orphans"
	| "broken-links"
	| "dead-ends"
	| "attention-map";

interface NamedPreset {
	name: string;
	builtinId?: BuiltinPresetId;
}

/**
 * What the panel shows. Bundled presets resolve through the locale table; an
 * unknown id (a preset written by a newer version) keeps its stored name rather
 * than rendering a raw key.
 */
export function presetDisplayName(preset: NamedPreset): string {
	if (!preset.builtinId) return preset.name;
	const key = `preset.${preset.builtinId}` as TranslationKey;
	return key in en ? t(key) : preset.name;
}

/**
 * Fold the current bundled set into what the user has stored.
 *
 * Bundled presets are replaced by their latest definition, retired ones are
 * dropped, everything else survives untouched — including a built-in the user
 * renamed, which counts as theirs from then on.
 */
export function migrateViewPresets<T extends NamedPreset>(
	stored: readonly T[],
	defaults: readonly T[],
	retired: ReadonlySet<string>
): T[] {
	const defaultNames = new Set(defaults.map((preset) => preset.name));
	const defaultIds = new Set(defaults.map((preset) => preset.builtinId));
	const userPresets = stored.filter(
		(preset) =>
			!defaultNames.has(preset.name) &&
			!retired.has(preset.name) &&
			!(preset.builtinId !== undefined && defaultIds.has(preset.builtinId))
	);
	return [...defaults, ...userPresets];
}
