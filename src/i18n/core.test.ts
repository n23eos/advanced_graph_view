import { describe, expect, it } from "vitest";
import { resolveLocale, translate } from "./core";

const AVAILABLE = ["en", "ru", "fr", "it", "de", "es", "pt-BR", "zh", "ja", "ko", "uk", "pl"];

describe("resolveLocale", () => {
	it("returns an exact match", () => {
		expect(resolveLocale("fr", AVAILABLE)).toBe("fr");
	});

	it("matches a regional code exactly when the locale exists", () => {
		expect(resolveLocale("pt-BR", AVAILABLE)).toBe("pt-BR");
	});

	it("falls back from an unknown region to the base language", () => {
		// Obsidian reports fr-CA; we only ship fr.
		expect(resolveLocale("fr-CA", AVAILABLE)).toBe("fr");
	});

	it("maps Chinese regional codes onto the simplified locale", () => {
		expect(resolveLocale("zh-CN", AVAILABLE)).toBe("zh");
		expect(resolveLocale("zh-Hans", AVAILABLE)).toBe("zh");
	});

	it("does not silently downgrade traditional Chinese to simplified", () => {
		// Shipping simplified text to a zh-TW user is worse than English.
		expect(resolveLocale("zh-TW", AVAILABLE)).toBe("en");
	});

	it("ignores case and underscore separators", () => {
		expect(resolveLocale("PT_br", AVAILABLE)).toBe("pt-BR");
	});

	it("falls back to English for an unshipped language", () => {
		expect(resolveLocale("hu", AVAILABLE)).toBe("en");
	});

	it("falls back to English for empty or junk input", () => {
		expect(resolveLocale("", AVAILABLE)).toBe("en");
		expect(resolveLocale("   ", AVAILABLE)).toBe("en");
	});
});

describe("translate", () => {
	const fallback = { greeting: "Hello", parting: "Bye", count: "{n} notes" };
	const table = { greeting: "Bonjour", parting: "", count: "{n} notes" };

	it("returns the active locale string", () => {
		expect(translate(table, fallback, "greeting")).toBe("Bonjour");
	});

	it("falls back to English when the locale has no value for the key", () => {
		expect(translate({ greeting: "Bonjour" }, fallback, "parting")).toBe("Bye");
	});

	it("treats an empty translation as missing", () => {
		expect(translate(table, fallback, "parting")).toBe("Bye");
	});

	it("returns the key itself when neither table has it", () => {
		// Visible-but-harmless beats an empty label hiding a broken build.
		expect(translate(table, fallback, "nope")).toBe("nope");
	});

	it("interpolates named parameters", () => {
		expect(translate(table, fallback, "count", { n: 42 })).toBe("42 notes");
	});

	it("leaves unknown placeholders untouched", () => {
		expect(translate({ x: "{a} and {b}" }, fallback, "x", { a: "one" })).toBe("one and {b}");
	});

	it("replaces every occurrence of a placeholder", () => {
		expect(translate({ x: "{a}-{a}" }, fallback, "x", { a: 7 })).toBe("7-7");
	});
});
