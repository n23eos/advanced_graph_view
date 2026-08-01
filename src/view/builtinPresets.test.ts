import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_PRESETS, RETIRED_VIEW_PRESETS } from "./builtinPresets";
import { en } from "../i18n/locales/en";

const byId = (id: string) => DEFAULT_VIEW_PRESETS.find((preset) => preset.builtinId === id);

describe("bundled view presets", () => {
	it("gives every preset a builtin id and a translatable name", () => {
		for (const preset of DEFAULT_VIEW_PRESETS) {
			expect(preset.builtinId).toBeDefined();
			expect(`preset.${preset.builtinId}` in en).toBe(true);
		}
	});

	it("uses each id only once", () => {
		const ids = DEFAULT_VIEW_PRESETS.map((preset) => preset.builtinId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("never ships a preset whose name is on the retired list", () => {
		const retired = DEFAULT_VIEW_PRESETS.filter((preset) => RETIRED_VIEW_PRESETS.has(preset.name));
		expect(retired).toEqual([]);
	});

	it("leaves overlays off on the non-diagnostic presets", () => {
		const diagnostic = new Set(["orphans", "broken-links", "dead-ends"]);
		for (const preset of DEFAULT_VIEW_PRESETS) {
			if (diagnostic.has(preset.builtinId ?? "")) continue;
			expect(preset.panel.overlays).toEqual({ orphans: false, deadEnds: false, broken: false });
		}
	});

	it.each([
		["orphans", "orphans"],
		["broken-links", "broken"],
		["dead-ends", "deadEnds"],
	] as const)("turns on exactly the %s overlay", (presetId, overlayKey) => {
		const overlays = byId(presetId)?.panel.overlays;
		expect(overlays).toBeDefined();
		const on = Object.entries(overlays ?? {})
			.filter(([, enabled]) => enabled)
			.map(([key]) => key);
		expect(on).toEqual([overlayKey]);
	});

	it("labels the diagnostic presets so matches can be acted on", () => {
		for (const presetId of ["orphans", "broken-links", "dead-ends"]) {
			expect(byId(presetId)?.panel.labels.show).toBe(true);
		}
	});

	it("maps attention map to structural importance against recent opens", () => {
		const panel = byId("attention-map")?.panel;
		expect(panel?.channels.size).toBe("pagerank");
		expect(panel?.channels.color).toBe("opens-90");
	});
});
