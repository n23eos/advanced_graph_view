import { describe, expect, test } from "vitest";
import * as normalization from "./normalize";
import { DEFAULT_SETTINGS } from "./schema";
import { buildProfile, mergeProfile } from "./profile";

const legacy = { linkStrength: 0.4, velocityDecay: 0.4, repel: 50, linkDistance: 40, centering: 0.04 };

describe("physics defaults migration", () => {
	test("migrates an unversioned payload once without mutating it", () => {
		const before = normalization.normalizeSettings({ panel: { physics: legacy } });
		const next = normalization.migratePhysicsDefaults(before);
		expect(next.physicsDefaultsVersion).toBe(1);
		expect(next.panel.physics).toMatchObject({ linkStrength: 0.15, velocityDecay: 0.55, repel: 30, linkDistance: 25, centering: 0.09 });
		expect(before.panel.physics).toMatchObject(legacy);
		expect(normalization.migratePhysicsDefaults(next)).toBe(next);
	});
	test("preserves user choices after migration, including future versions", () => {
		for (const physicsDefaultsVersion of [1, 2]) {
			const saved = normalization.normalizeSettings({ physicsDefaultsVersion, panel: { physics: legacy } });
			expect(normalization.migratePhysicsDefaults(saved)).toBe(saved);
		}
	});
	test("leaves custom physics and fresh defaults unchanged", () => {
		const settings = normalization.normalizeSettings({ panel: { physics: { repel: 93, linkStrength: 0.31 } } });
		expect(normalization.migratePhysicsDefaults(settings).panel.physics).toEqual(settings.panel.physics);
		expect(normalization.migratePhysicsDefaults(DEFAULT_SETTINGS).panel.physics).toEqual(DEFAULT_SETTINGS.panel.physics);
	});
	test.each([undefined, null, "1", NaN, Infinity])("normalizes invalid version %s to zero", (physicsDefaultsVersion) => {
		expect(normalization.normalizeSettings({ physicsDefaultsVersion }).physicsDefaultsVersion).toBe(0);
	});
	test("migrates an old imported profile even when the vault already migrated", () => {
		const next = mergeProfile({ ...DEFAULT_SETTINGS, physicsDefaultsVersion: 1 }, { version: 1, panel: { physics: legacy } });
		expect(next?.panel.physics.linkStrength).toBe(0.15);
		expect(next?.physicsDefaultsVersion).toBe(1);
	});
	test("round-trips migrated user choices through profile export", () => {
		const settings = normalization.normalizeSettings({ physicsDefaultsVersion: 1, panel: { physics: legacy } });
		const profile: unknown = JSON.parse(JSON.stringify(buildProfile(settings)));
		expect(profile).toHaveProperty("physicsDefaultsVersion", 1);
		expect(mergeProfile(DEFAULT_SETTINGS, profile)?.panel.physics).toEqual(settings.panel.physics);
	});
	test("does not migrate current physics when importing a profile without a panel", () => {
		const settings = normalization.normalizeSettings({ physicsDefaultsVersion: 1, panel: { physics: legacy } });
		expect(mergeProfile(settings, { version: 1 })?.panel.physics).toEqual(settings.panel.physics);
	});
});
