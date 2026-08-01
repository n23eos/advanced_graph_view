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
		const current = { ...DEFAULT_SETTINGS, onboardingShown: true, viewPresetsVersion: 7 };

		const restored = mergeProfile(current, buildProfile(settings));

		expect(restored?.onboardingShown).toBe(true);
		expect(restored?.viewPresetsVersion).toBe(7);
	});

	test("fills in fields the profile is missing from the current settings", () => {
		const partial = { version: PROFILE_VERSION, panel: settings.panel };

		const restored = mergeProfile(DEFAULT_SETTINGS, partial);

		expect(restored?.panel).toEqual(settings.panel);
		expect(restored?.openDwellSeconds).toBe(DEFAULT_SETTINGS.openDwellSeconds);
	});
});
