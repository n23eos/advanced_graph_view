import { describe, expect, test } from "vitest";
import { formatPhysicsDiff, physicsDiff, recommendedPhysics } from "./physicsReset";
import { DEFAULT_VIEW_PRESETS } from "../view/builtinPresets";

const byId = (id: string) => DEFAULT_VIEW_PRESETS.find((preset) => preset.builtinId === id)!;

describe("recommendedPhysics (F-07)", () => {
	test("the applied builtin preset is the baseline", () => {
		const orphans = byId("orphans");
		expect(recommendedPhysics(orphans, true)).toBe(orphans.panel.physics);
	});

	test("a user preset falls through to the bundled default for the dimension", () => {
		const user = { name: "Mine", panel: byId("orphans").panel };
		expect(recommendedPhysics(user, true)).toBe(byId("default-3d").panel.physics);
		expect(recommendedPhysics(user, false)).toBe(byId("default-2d").panel.physics);
		expect(recommendedPhysics(null, false)).toBe(byId("default-2d").panel.physics);
	});
});

describe("physicsDiff", () => {
	const base = byId("default-3d").panel.physics;

	test("identical params produce an empty diff", () => {
		expect(physicsDiff(base, { ...base })).toEqual([]);
	});

	test("changed numeric and boolean fields are listed", () => {
		const tweaked = { ...base, repel: base.repel + 10, freeLayout: !base.freeLayout };
		const diff = physicsDiff(tweaked, base);
		expect(diff).toHaveLength(2);
		expect(diff.map((c) => c.key).sort()).toEqual(["freeLayout", "repel"]);
	});

	test("the summary is readable", () => {
		expect(formatPhysicsDiff([{ key: "repel", from: 30, to: 112 }])).toBe("repel 30→112");
	});
});
