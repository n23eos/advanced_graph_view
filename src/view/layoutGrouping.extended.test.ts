import { expect, test } from "vitest";
import { computeGroups, depthByAge } from "./layoutGrouping";
import type { NodeFacts } from "../encoding/metrics";
const note = { ctime: 100, mtime: 100 } as NodeFacts;
const missing = { ctime: 0, mtime: 0, kind: "unresolved" } as NodeFacts;
test("unknown dates do not invent an age group or distort real-note depth", () => {
	expect([...computeGroups("age", [note, missing])]).toEqual([0, -1]);
	expect([...computeGroups("recency", [note, missing], 100)]).toEqual([0, -1]);
	expect(depthByAge([note, missing])[0]).toBe(depthByAge([note])[0]);
	expect(depthByAge([note, missing])[1]).toBe(0);
});
