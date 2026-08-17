import { describe, expect, test } from "vitest";
import { NavigationTrail, TRAIL_CAP } from "./navigationTrail";

const crumb = (path: string) => ({ path, label: path });

describe("NavigationTrail (F-11)", () => {
	test("pushes build the trail and move the active crumb", () => {
		const trail = new NavigationTrail("explore");
		trail.push(crumb("a"));
		trail.push(crumb("b"));
		expect(trail.items.map((c) => c.path)).toEqual(["a", "b"]);
		expect(trail.activeCrumb?.path).toBe("b");
	});

	test("a repeated push of the active path is a no-op", () => {
		const trail = new NavigationTrail("focus");
		trail.push(crumb("a"));
		trail.push(crumb("a"));
		expect(trail.items).toHaveLength(1);
	});

	test("back steps the index without cutting the tail", () => {
		const trail = new NavigationTrail("explore");
		["a", "b", "c"].forEach((p) => trail.push(crumb(p)));
		expect(trail.back()?.path).toBe("b");
		expect(trail.items).toHaveLength(3);
		expect(trail.back()?.path).toBe("a");
		expect(trail.back()).toBeNull();
	});

	test("the tail is only overwritten by the next new transition", () => {
		const trail = new NavigationTrail("explore");
		["a", "b", "c", "d"].forEach((p) => trail.push(crumb(p)));
		trail.jumpTo(1);
		expect(trail.items.map((c) => c.path)).toEqual(["a", "b", "c", "d"]);
		trail.push(crumb("x"));
		expect(trail.items.map((c) => c.path)).toEqual(["a", "b", "x"]);
	});

	test("the history is capped, dropping the oldest crumbs", () => {
		const trail = new NavigationTrail("explore");
		for (let i = 0; i < TRAIL_CAP + 10; i++) trail.push(crumb(`n${i}`));
		expect(trail.items).toHaveLength(TRAIL_CAP);
		expect(trail.items[0].path).toBe("n10");
		expect(trail.activeCrumb?.path).toBe(`n${TRAIL_CAP + 9}`);
	});

	test("removing a missing crumb keeps the active one sensible", () => {
		const trail = new NavigationTrail("explore");
		["a", "b", "c"].forEach((p) => trail.push(crumb(p)));
		trail.removeAt(0);
		expect(trail.items.map((c) => c.path)).toEqual(["b", "c"]);
		expect(trail.activeCrumb?.path).toBe("c");
		trail.removeAt(1);
		expect(trail.activeCrumb?.path).toBe("b");
	});
});
