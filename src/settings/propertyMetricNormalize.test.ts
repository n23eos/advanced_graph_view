import { describe, expect, test } from "vitest";
import { DEFAULT_3D_PANEL } from "../view/builtinPresets";
import { normalizePanel, normalizeViewPresets } from "./normalize";
import { DEFAULT_SETTINGS } from "./schema";

describe("property metric persistence", () => {
	test("keeps valid property color metrics in panel state and view presets", () => {
		const panel = normalizePanel({ ...DEFAULT_3D_PANEL, channels: { ...DEFAULT_3D_PANEL.channels, color: "prop:status" } });
		expect(panel.channels.color).toBe("prop:status");

		const [preset] = normalizeViewPresets([{
			name: "By status",
			panel: { ...DEFAULT_3D_PANEL, channels: { ...DEFAULT_3D_PANEL.channels, color: "prop:status" } },
		}]);
		expect(preset.panel.channels.color).toBe("prop:status");
	});

	test("falls back for malformed property ids and property metrics in numeric channels", () => {
		const panel = normalizePanel({
			...DEFAULT_3D_PANEL,
			channels: { size: "prop:status", color: "prop:", glow: "prop:team" },
		});
		expect(panel.channels).toEqual(DEFAULT_SETTINGS.panel.channels);
	});
});
