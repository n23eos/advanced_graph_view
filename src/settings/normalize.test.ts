import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "./schema";
import { normalizeSettings } from "./normalize";
import { DEFAULT_3D_PANEL } from "../view/builtinPresets";

const NOW = 1_755_000_000_000;

describe("normalizeSettings", () => {
	test("null and empty payloads produce the defaults", () => {
		for (const raw of [null, undefined, {}]) {
			const settings = normalizeSettings(raw, NOW);
			expect(settings.onboardingState).toBe("never-seen");
			expect(settings.panel.layoutRule).toBe("links");
			expect(settings.collapsedSections).toEqual({ physics: true });
			expect(settings.presets).toEqual([]);
		}
	});

	test("does not carry the legacy onboardingShown flag forward", () => {
		const settings = normalizeSettings({ onboardingShown: true }, NOW) as unknown as Record<string, unknown>;
		expect(settings).not.toHaveProperty("onboardingShown");
	});

	describe("onboarding migration", () => {
		test("onboardingShown: true means the user opted out for good", () => {
			expect(normalizeSettings({ onboardingShown: true }, NOW).onboardingState).toBe("disabled");
		});

		test("onboardingShown: false means a fresh install", () => {
			expect(normalizeSettings({ onboardingShown: false }, NOW).onboardingState).toBe("never-seen");
		});

		test("an already-migrated state wins over the legacy flag", () => {
			const raw = { onboardingShown: true, onboardingState: "completed" };
			expect(normalizeSettings(raw, NOW).onboardingState).toBe("completed");
		});

		test("an unknown state falls back to never-seen", () => {
			expect(normalizeSettings({ onboardingState: "wizard" }, NOW).onboardingState).toBe("never-seen");
		});
	});

	describe("search preset migration", () => {
		test("legacy {name, query} presets gain id and timestamps, keeping name and query", () => {
			const raw = { presets: [{ name: "Work", query: "tag:#work" }] };
			const [preset] = normalizeSettings(raw, NOW).presets;
			expect(preset.name).toBe("Work");
			expect(preset.query).toBe("tag:#work");
			expect(preset.id).toBeTruthy();
			expect(preset.createdAt).toBe(NOW);
			expect(preset.updatedAt).toBe(NOW);
		});

		test("already-migrated presets keep their id and timestamps untouched", () => {
			const raw = { presets: [{ id: "abc", name: "Work", query: "tag:#work", createdAt: 1, updatedAt: 2 }] };
			expect(normalizeSettings(raw, NOW).presets[0]).toEqual(raw.presets[0]);
		});

		test("duplicate ids are regenerated so every id stays unique", () => {
			const raw = {
				presets: [
					{ id: "abc", name: "A", query: "a", createdAt: 1, updatedAt: 1 },
					{ id: "abc", name: "B", query: "b", createdAt: 2, updatedAt: 2 },
				],
			};
			const presets = normalizeSettings(raw, NOW).presets;
			expect(presets[0].id).toBe("abc");
			expect(presets[1].id).not.toBe("abc");
			expect(presets[1].name).toBe("B");
		});

		test("two legacy presets never share a generated id", () => {
			const raw = { presets: [{ name: "A", query: "a" }, { name: "B", query: "b" }] };
			const presets = normalizeSettings(raw, NOW).presets;
			expect(presets[0].id).not.toBe(presets[1].id);
		});

		test("rows that are not presets are dropped", () => {
			const raw = { presets: [{ name: "A", query: "a" }, "junk", { name: 5 }] };
			expect(normalizeSettings(raw, NOW).presets).toHaveLength(1);
		});
	});

	describe("layout rule migration", () => {
		test("a panel without layoutRule gets links", () => {
			const raw = { panel: { ...DEFAULT_3D_PANEL } };
			delete (raw.panel as Record<string, unknown>).layoutRule;
			expect(normalizeSettings(raw, NOW).panel.layoutRule).toBe("links");
		});

		test("an unknown layoutRule falls back to links", () => {
			const raw = { panel: { ...DEFAULT_3D_PANEL, layoutRule: "banana" } };
			expect(normalizeSettings(raw, NOW).panel.layoutRule).toBe("links");
		});

		test("a valid layoutRule survives", () => {
			const raw = { panel: { ...DEFAULT_3D_PANEL, layoutRule: "tags" } };
			expect(normalizeSettings(raw, NOW).panel.layoutRule).toBe("tags");
		});

		test("saved view presets get their layoutRule normalized too", () => {
			const raw = {
				viewPresets: [
					{ name: "Mine", panel: { ...DEFAULT_3D_PANEL, layoutRule: "banana" } },
					{ name: "Ok", panel: { ...DEFAULT_3D_PANEL, layoutRule: "folders" } },
				],
			};
			const presets = normalizeSettings(raw, NOW).viewPresets;
			expect(presets[0].panel.layoutRule).toBe("links");
			expect(presets[1].panel.layoutRule).toBe("folders");
			expect(presets[0].appearance?.mode).toBe("legacy");
			expect(presets[1].appearance?.mode).toBe("legacy");
		});
	});

	describe("deep merge of older payloads", () => {
		test("backfills the optional build 3 appearance fields", () => {
			const panel = normalizeSettings({ panel: { labels: { show: false } } }, NOW).panel;

			expect(panel.labels).toMatchObject({
				hoverOnly: false,
				hubs: 8,
				fadeMs: 200,
				rank: "degree",
			});
			expect(panel.edges.curvature).toBe(0.18);
			expect(panel.glowIntensity).toBe(1);
			expect(panel.folders).toEqual({ enabled: true, level: "top", overrides: {} });
		});

		test("normalizes invalid build 3 appearance values independently", () => {
			const panel = normalizeSettings({
				panel: {
					labels: { hoverOnly: "yes", hubs: 999, fadeMs: -20, rank: "random" },
					edges: { curvature: Number.NaN },
					glowIntensity: Infinity,
					folders: {
						enabled: "yes",
						level: "middle",
						overrides: { Work: "#abcdef", Bad: "red", "": "#fff" },
					},
				},
			}, NOW).panel;

			expect(panel.labels).toMatchObject({
				hoverOnly: false,
				hubs: 64,
				fadeMs: 0,
				rank: "degree",
			});
			expect(panel.edges.curvature).toBe(0.18);
			expect(panel.glowIntensity).toBe(1);
			expect(panel.folders).toEqual({
				enabled: true,
				level: "top",
				overrides: { Work: "#abcdef" },
			});
		});

		test("marks old full and partial panels as legacy appearances", () => {
			const full = normalizeSettings({ panel: DEFAULT_3D_PANEL }, NOW);
			const partial = normalizeSettings({ panel: { nodeScale: 2 } }, NOW);

			expect(full.appearance.mode).toBe("legacy");
			expect(full.appearance.panel.nodeScale).toBe(DEFAULT_3D_PANEL.nodeScale);
			expect(partial.appearance.mode).toBe("legacy");
			expect(partial.appearance.panel.nodeScale).toBe(2);
			expect(partial.appearance.panel.edges).toEqual({
				...DEFAULT_SETTINGS.panel.edges,
				curvature: 0.18,
			});
		});

		test("round-trips a versioned modern appearance", () => {
			const raw = {
				panel: { nodeScale: 2 },
				appearance: {
					version: 1,
					mode: "modern",
					panel: { nodeScale: 3, edges: { opacity: 0.7 } },
				},
			};

			const settings = normalizeSettings(raw, NOW);
			expect(settings.appearance.mode).toBe("modern");
			expect(settings.appearance.panel.nodeScale).toBe(3);
			expect(settings.appearance.panel.edges).toEqual({
				...DEFAULT_SETTINGS.panel.edges,
				opacity: 0.7,
				curvature: 0.18,
			});
		});

		test("legacy palettes keep their previous node style", () => {
			expect(normalizeSettings({ panel: { colorPreset: "galaxy" } }, NOW).panel.nodeStyle).toBe("glow");
			expect(normalizeSettings({ panel: { colorPreset: "recency" } }, NOW).panel.nodeStyle).toBe("flat");
		});

		test("valid node styles survive and unknown styles use the default", () => {
			expect(normalizeSettings({ panel: { nodeStyle: "ring" } }, NOW).panel.nodeStyle).toBe("ring");
			expect(normalizeSettings({ panel: { nodeStyle: "sparkles" } }, NOW).panel.nodeStyle)
				.toBe(DEFAULT_SETTINGS.panel.nodeStyle);
		});

		test("a partial panel picks up newly added fields from the defaults", () => {
			const raw = { panel: { nodeScale: 2 } };
			const settings = normalizeSettings(raw, NOW);
			expect(settings.panel.nodeScale).toBe(2);
			expect(settings.panel.overlays).toEqual(DEFAULT_SETTINGS.panel.overlays);
			expect(settings.panel.physics).toEqual(DEFAULT_SETTINGS.panel.physics);
		});

		test("nested option groups merge field by field", () => {
			const raw = { hoverPreview: { words: 42 }, localGraph: { depth: 4 } };
			const settings = normalizeSettings(raw, NOW);
			expect(settings.hoverPreview).toEqual({ ...DEFAULT_SETTINGS.hoverPreview, words: 42 });
			expect(settings.localGraph).toEqual({ ...DEFAULT_SETTINGS.localGraph, depth: 4 });
		});

		test("scalar settings survive the round trip", () => {
			const raw = { openDwellSeconds: 12, followActiveNote: true };
			const settings = normalizeSettings(raw, NOW);
			expect(settings.openDwellSeconds).toBe(12);
			expect(settings.followActiveNote).toBe(true);
		});
	});

	test("a stored collapsedSections preference survives", () => {
		const settings = normalizeSettings({ collapsedSections: { physics: false } }, NOW);
		expect(settings.collapsedSections).toEqual({ physics: false });
	});
});
