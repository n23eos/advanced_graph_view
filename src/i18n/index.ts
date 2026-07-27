/**
 * Translation entry point.
 *
 * Deliberately free of any `obsidian` import: encoding and analysis modules
 * pull `t()` in, and those run under the test runner where `obsidian` does not
 * resolve. The host passes the app language in via `initI18n()`.
 */
import { resolveLocale, translate, type TranslationParams } from "./core";
import { en } from "./locales/en";
import { LOCALE_TABLES } from "./tables";
import type { Translation, TranslationKey } from "./types";

const LOCALES: Readonly<Record<string, Translation>> = LOCALE_TABLES;

export const AVAILABLE_LOCALES = Object.keys(LOCALES);

let activeTable: Translation = en;
let activeCode = "en";

/**
 * Point the UI at the app language. Call once during plugin load, before any
 * view is built. Returns the locale actually selected.
 */
export function initI18n(language: string): string {
	activeCode = resolveLocale(language, AVAILABLE_LOCALES);
	activeTable = LOCALES[activeCode] ?? en;
	return activeCode;
}

/** The locale currently in use — the resolved one, not what the app reported. */
export function activeLocale(): string {
	return activeCode;
}

/** Translate `key`, substituting `{name}` placeholders from `params`. */
export function t(key: TranslationKey, params?: TranslationParams): string {
	return translate(activeTable, en, key, params);
}

export type { TranslationKey, Translation };
