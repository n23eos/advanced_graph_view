import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "./schema";
import { PROFILE_VERSION, buildProfile, mergeProfile } from "./profile";

const settings = {
	...DEFAULT_SETTINGS,
	openDwellSeconds: 12,
	hoverPreview: { enabled: false, words: 120, delayMs: 500 },
	chipFilter: { tags: ["#work"], folders: [] },
	followActiveNote: true,
};

describe("buildProfile", () => {
	test("carries the settings that describe how the plugin looks and behaves", () => {
		const profile = buildProfile(settings);

		expect(profile.version).toBe(PROFILE_VERSION);
		expect(profile.openDwellSeconds).toBe(12);
		expect(profile.followActiveNote).toBe(true);
		expect(profile.panel).toEqual(settings.panel);
	});

	test("leaves out anything that belongs to this vault alone", () => {
		const profile = buildProfile(settings) as unknown as Record<string, unknown>;

		expect(profile).not.toHaveProperty("onboardingShown");
		expect(profile).not.toHaveProperty("viewPresetsVersion");
	});
});

describe("mergeProfile", () => {
	test("round-trips a profile it wrote itself", () => {
		const restored = mergeProfile(DEFAULT_SETTINGS, JSON.parse(JSON.stringify(buildProfile(settings))));

		expect(restored?.openDwellSeconds).toBe(12);
		expect(restored?.hoverPreview).toEqual(settings.hoverPreview);
		expect(restored?.chipFilter).toEqual(settings.chipFilter);
	});

	test("rejects anything that is not a profile", () => {
		expect(mergeProfile(DEFAULT_SETTINGS, null)).toBeNull();
		expect(mergeProfile(DEFAULT_SETTINGS, "settings")).toBeNull();
		expect(mergeProfile(DEFAULT_SETTINGS, { panel: {} })).toBeNull();
	});

	test("rejects a profile written by a newer, unknown format", () => {
		const future = { ...buildProfile(settings), version: PROFILE_VERSION + 1 };

		expect(mergeProfile(DEFAULT_SETTINGS, future)).toBeNull();
	});

	test("keeps this vault's own state rather than importing it", () => {
		const current = { ...DEFAULT_SETTINGS, onboardingState: "disabled" as const, viewPresetsVersion: 7 };

		const restored = mergeProfile(current, buildProfile(settings));

		expect(restored?.onboardingState).toBe("disabled");
		expect(restored?.viewPresetsVersion).toBe(7);
	});

	test("replaces an unknown layout rule with links instead of rejecting the profile", () => {
		const foreign = {
			...buildProfile(settings),
			panel: { ...settings.panel, layoutRule: "banana" as never },
		};

		const restored = mergeProfile(DEFAULT_SETTINGS, foreign);

		expect(restored?.panel.layoutRule).toBe("links");
	});

	test("backfills id and timestamps on presets from an old-format profile", () => {
		const legacy = {
			version: PROFILE_VERSION,
			panel: settings.panel,
			presets: [{ name: "Work", query: "tag:#work" }],
		};

		const restored = mergeProfile(DEFAULT_SETTINGS, legacy);

		expect(restored?.presets[0].name).toBe("Work");
		expect(restored?.presets[0].id).toBeTruthy();
		expect(restored?.presets[0].createdAt).toBeTypeOf("number");
	});

	test("fills in fields the profile is missing from the current settings", () => {
		const partial = { version: PROFILE_VERSION, panel: settings.panel };

		const restored = mergeProfile(DEFAULT_SETTINGS, partial);

		expect(restored?.panel).toEqual(settings.panel);
		expect(restored?.openDwellSeconds).toBe(DEFAULT_SETTINGS.openDwellSeconds);
	});

	test("carries the panel mode across vaults", () => {
		const restored = mergeProfile(DEFAULT_SETTINGS, buildProfile({ ...settings, panelMode: "expert" }));

		expect(restored?.panelMode).toBe("expert");
	});

	test("keeps the current mode when an older profile has none", () => {
		const legacy = { version: PROFILE_VERSION, panel: settings.panel };

		const restored = mergeProfile({ ...DEFAULT_SETTINGS, panelMode: "expert" }, legacy);

		expect(restored?.panelMode).toBe("expert");
	});

	test("ignores a mode the plugin does not know", () => {
		const bogus = { version: PROFILE_VERSION, panel: settings.panel, panelMode: "wizard" };

		const restored = mergeProfile(DEFAULT_SETTINGS, bogus);

		expect(restored?.panelMode).toBe(DEFAULT_SETTINGS.panelMode);
	});
});
