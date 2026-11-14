// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { categoryColor } from "../encoding/colorScales";
import { initI18n } from "../i18n";
import { activePreset } from "../render/theme";
import { installObsidianDom } from "../test/obsidianDom";
import { Legend } from "./Legend";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

afterEach(() => {
	document.body.classList.remove("theme-light");
	document.body.empty();
});

function toHex(color: number): string {
	return `#${color.toString(16).padStart(6, "0")}`;
}

function cssColor(doc: Document, color: number): string {
	const element = doc.body.createSpan();
	element.style.background = toHex(color);
	const result = element.style.background;
	element.remove();
	return result;
}

function cssGradient(doc: Document, stops: readonly number[]): string {
	const element = doc.body.createSpan();
	element.style.background = `linear-gradient(to right, ${stops.map(toHex).join(", ")})`;
	const result = element.style.background;
	element.remove();
	return result;
}

describe("Legend host document", () => {
	test("uses the iframe light theme for gradient and category colors", () => {
		const frame = document.body.createEl("iframe");
		const hostWindow = frame.contentWindow!;
		const hostDocument = hostWindow.document;
		installObsidianDom(hostWindow);
		hostDocument.body.classList.add("theme-light");
		const host = hostDocument.body.createDiv();
		const legend = new Legend(host);

		legend.update("recency-edit", "recency", null);
		const gradient = host.querySelector<HTMLElement>(".graph-insight-legend-bar")!.style.background;
		const lightPreset = activePreset("recency", hostDocument);
		const darkPreset = activePreset("recency", document);
		expect(gradient).toBe(cssGradient(hostDocument, lightPreset.stops));
		expect(gradient).not.toBe(cssGradient(document, darkPreset.stops));

		legend.update("folder", "recency", ["c"]);
		const swatch = host.querySelector<HTMLElement>(".graph-insight-legend-swatch")!;
		expect(swatch.style.background).toBe(cssColor(
			hostDocument,
			categoryColor("c", lightPreset.categories)
		));
		expect(swatch.style.background).not.toBe(cssColor(
			document,
			categoryColor("c", darkPreset.categories)
		));

		legend.destroy();
	});
});
