import { describe, expect, it } from "vitest";
import { AVAILABLE_LOCALES, initI18n, t } from "./index";
import { en } from "./locales/en";
import { LOCALE_TABLES } from "./tables";

const KEYS = Object.keys(en);

describe("locale files", () => {
	it("ships every language listed in the plan", () => {
		expect(AVAILABLE_LOCALES.sort()).toEqual(
			["de", "en", "es", "fr", "it", "ja", "ko", "pl", "pt-BR", "ru", "uk", "zh"].sort()
		);
	});

	for (const [code, table] of Object.entries(LOCALE_TABLES)) {
		describe(code, () => {
			it("covers every English key", () => {
				expect(Object.keys(table).sort()).toEqual(KEYS.sort());
			});

			it("has no blank values", () => {
				const blank = Object.entries(table)
					.filter(([, value]) => value.trim() === "")
					.map(([key]) => key);
				expect(blank).toEqual([]);
			});

			it("keeps the same placeholders as English", () => {
				const placeholders = (value: string) =>
					(value.match(/\{(\w+)\}/g) ?? []).sort().join(",");
				const mismatched = Object.entries(table)
					.filter(([key, value]) => placeholders(value) !== placeholders(en[key as keyof typeof en]))
					.map(([key]) => key);
				expect(mismatched).toEqual([]);
			});
		});
	}
});

describe("initI18n", () => {
	it("switches the active table", () => {
		initI18n("fr");
		expect(t("presets.delete")).toBe(LOCALE_TABLES.fr["presets.delete"]);
		initI18n("en");
		expect(t("presets.delete")).toBe("Delete");
	});

	it("falls back to English for an unshipped language", () => {
		expect(initI18n("hu")).toBe("en");
		expect(t("presets.delete")).toBe("Delete");
	});

	it("interpolates through the active locale", () => {
		initI18n("ru");
		expect(t("legend.more", { count: 3 })).toContain("3");
		initI18n("en");
	});
});
