/**
 * Pure translation primitives — no Obsidian, no module state, so both halves
 * of the i18n layer stay unit-testable.
 */

/** A locale table. Partial: a translation may lag behind the English source. */
export type StringTable = Readonly<Record<string, string>>;

/** Values allowed in `{placeholder}` interpolation. */
export type TranslationParams = Readonly<Record<string, string | number>>;

/** Codes Obsidian may report that mean a locale we ship under another name. */
const LOCALE_ALIASES: Readonly<Record<string, string>> = {
	"zh-cn": "zh",
	"zh-hans": "zh",
	"zh-sg": "zh",
};

/**
 * Variants that must never fall back to their base language: traditional
 * Chinese readers get English rather than simplified text, which reads as
 * broken rather than merely untranslated.
 */
const NO_BASE_FALLBACK = new Set(["zh-tw", "zh-hant", "zh-hk", "zh-mo"]);

/**
 * Pick the best locale we ship for the app language.
 *
 * Exact match first, then a documented alias, then the base language
 * (`fr-CA` → `fr`), then English. Regional variants are never collapsed into a
 * sibling — a zh-TW reader gets English rather than simplified Chinese.
 */
export function resolveLocale(language: string, available: readonly string[]): string {
	const normalized = language.trim().replace(/_/g, "-").toLowerCase();
	if (!normalized) return "en";

	const byLowerCase = new Map(available.map((code) => [code.toLowerCase(), code]));

	const exact = byLowerCase.get(normalized);
	if (exact) return exact;

	const aliased = LOCALE_ALIASES[normalized];
	if (aliased && byLowerCase.has(aliased)) return byLowerCase.get(aliased) as string;

	if (NO_BASE_FALLBACK.has(normalized)) return "en";

	const base = normalized.split("-")[0];
	// Only fall back to the bare base language, never to another region's file.
	const baseMatch = byLowerCase.get(base);
	if (baseMatch) return baseMatch;

	return "en";
}

/**
 * Look up `key`, falling back to English and finally to the key itself, then
 * substitute `{name}` placeholders.
 */
export function translate(
	table: StringTable,
	fallback: StringTable,
	key: string,
	params?: TranslationParams
): string {
	// An empty string counts as missing: a blank label looks like a rendering
	// bug, while the English original is merely untranslated.
	const template = table[key] || fallback[key] || key;
	if (!params) return template;

	return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
		const value = params[name];
		return value === undefined ? placeholder : String(value);
	});
}
