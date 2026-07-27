import { en } from "./locales/en";

/** Every string the UI can render. Derived from English, so the compiler is the
 *  one that notices a key added without a translation. */
export type TranslationKey = keyof typeof en;

/** A complete locale. Incomplete files fail `tsc`, not runtime. */
export type Translation = Record<TranslationKey, string>;
