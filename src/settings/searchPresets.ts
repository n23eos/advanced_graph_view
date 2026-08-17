/**
 * Pure helpers for saved search filters (F-09): naming rules and the list
 * ordering shared by the dropdown and the manager modal.
 */
import type { SearchPreset } from "./schema";

export const PRESET_NAME_MAX = 80;

/** Trimmed name, or null when it breaks the 1–80 character rule. */
export function validatePresetName(raw: string): string | null {
	const name = raw.trim();
	if (name.length === 0 || name.length > PRESET_NAME_MAX) return null;
	return name;
}

/** Recently used first, the rest alphabetically (locale-aware). */
export function sortSearchPresets(
	presets: readonly SearchPreset[],
	locale?: string
): SearchPreset[] {
	return [...presets].sort((a, b) => {
		const usedA = a.lastUsedAt ?? 0;
		const usedB = b.lastUsedAt ?? 0;
		if (usedA !== usedB) return usedB - usedA;
		return a.name.localeCompare(b.name, locale);
	});
}
