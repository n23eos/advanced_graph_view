// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from "vitest";
import { activePreset, isLightTheme } from "./theme";
import { installObsidianDom } from "../test/obsidianDom";

beforeAll(() => installObsidianDom());
afterEach(() => { document.body.empty(); document.body.classList.remove("theme-light"); });

test("theme queries and preset adaptation use the supplied document", () => {
	const iframe = document.body.createEl("iframe");
	const doc = iframe.contentDocument!;
	doc.body.classList.add("theme-light");
	expect(isLightTheme(doc)).toBe(true);
	expect(isLightTheme()).toBe(false);
	expect(activePreset("default", doc)).not.toEqual(activePreset("default"));
	document.body.classList.add("theme-light");
	expect(activePreset("default", doc)).toEqual(activePreset("default"));
});
