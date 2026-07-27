/**
 * The locale registry. Separate from `index.ts` so tests can iterate every
 * table without going through the module-level active-locale state.
 *
 * `satisfies` is what enforces completeness: a table missing a key, or holding
 * one English no longer has, fails the build.
 */
import { de } from "./locales/de";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { pl } from "./locales/pl";
import { ptBR } from "./locales/pt-BR";
import { ru } from "./locales/ru";
import { uk } from "./locales/uk";
import { zh } from "./locales/zh";
import type { Translation } from "./types";

export const LOCALE_TABLES = {
	en,
	de,
	es,
	fr,
	it,
	ja,
	ko,
	pl,
	"pt-BR": ptBR,
	ru,
	uk,
	zh,
} satisfies Record<string, Translation>;
