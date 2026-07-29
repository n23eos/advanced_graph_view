import { describe, expect, it } from "vitest";
import { initI18n } from "../i18n";
import {
	migrateViewPresets,
	presetDisplayName,
	type BuiltinPresetId,
} from "./presetNames";

/** The panel snapshot is irrelevant here — only names and ids are migrated. */
const PANEL = {} as never;

interface TestPreset {
	name: string;
	builtinId?: BuiltinPresetId;
	panel: never;
}

const DEFAULTS: TestPreset[] = [
	{ builtinId: "default-3d" as const, name: "Default 3D", panel: PANEL },
	{ builtinId: "recent" as const, name: "Recent", panel: PANEL },
];
const RETIRED = new Set(["3D галактика"]);

describe("migrateViewPresets", () => {
	it("seeds the bundled presets into an empty install", () => {
		expect(migrateViewPresets([], DEFAULTS, RETIRED)).toEqual(DEFAULTS);
	});

	it("refreshes a stored built-in to the current definition", () => {
		const stored: TestPreset[] = [{ name: "Recent", panel: { stale: true } as never }];
		const result = migrateViewPresets(stored, DEFAULTS, RETIRED);
		expect(result).toEqual(DEFAULTS);
		// The stale copy is gone, not duplicated alongside the fresh one.
		expect(result.filter((p) => p.name === "Recent")).toHaveLength(1);
	});

	it("keeps a user preset untouched", () => {
		const mine: TestPreset = { name: "My galaxy", panel: PANEL };
		expect(migrateViewPresets([mine], DEFAULTS, RETIRED)).toEqual([...DEFAULTS, mine]);
	});

	it("keeps a renamed built-in as a user preset", () => {
		// Renaming is how a user adopts a bundled preset; never reclaim the name.
		const renamed: TestPreset = { name: "Default 3D but mine", panel: PANEL };
		const result = migrateViewPresets([renamed], DEFAULTS, RETIRED);
		expect(result).toContainEqual(renamed);
		expect(result.filter((p) => p.builtinId === "default-3d")).toHaveLength(1);
	});

	it("drops retired defaults", () => {
		const stored: TestPreset[] = [{ name: "3D галактика", panel: PANEL }];
		expect(migrateViewPresets(stored, DEFAULTS, RETIRED)).toEqual(DEFAULTS);
	});

	it("never mutates the stored array", () => {
		const stored: TestPreset[] = [{ name: "Mine", panel: PANEL }];
		const copy = [...stored];
		migrateViewPresets(stored, DEFAULTS, RETIRED);
		expect(stored).toEqual(copy);
	});
});

describe("presetDisplayName", () => {
	it("translates a bundled preset by its id", () => {
		initI18n("en");
		// The stored `name` stays the original literal — it is the migration key.
		expect(presetDisplayName({ builtinId: "hubs-clusters", name: "Hubs and Clusters" })).toBe(
			"Hubs and clusters"
		);
	});

	it("shows a user preset's literal name", () => {
		expect(presetDisplayName({ name: "My galaxy" })).toBe("My galaxy");
	});

	it("falls back to the stored name for an unknown id", () => {
		// A preset saved by a newer version, opened in an older one.
		expect(presetDisplayName({ builtinId: "from-the-future" as never, name: "Stored" })).toBe(
			"Stored"
		);
	});
});
