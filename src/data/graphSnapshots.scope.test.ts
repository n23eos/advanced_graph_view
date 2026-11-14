import { expect, test } from "vitest";
import { buildGraphModel } from "./GraphStore";
import { applyRetention, buildSnapshot, closestSnapshotBefore, normalizeSnapshotStore, shouldCapture } from "./graphSnapshots";
const model = buildGraphModel(["a.md"], {}, {});
const metrics = { pagerank: new Float32Array([1]), community: new Int32Array([0]), communityCount: 1 };
const scope = { attachments: true, unresolved: false };
const legacy = buildSnapshot(model, metrics, 1000);
const extended = { ...legacy, capturedAt: 2000, scope };
test("captures scope from the exact model and retains legacy payload shape", () => {
	expect(buildSnapshot({ ...model, scope }, metrics, 1000)).toHaveProperty("scope", scope);
	expect(legacy).not.toHaveProperty("scope");
});
test("history and capture cooldown select only the same scope", () => {
	const store = { version: 1 as const, snapshots: [legacy, extended] };
	expect(closestSnapshotBefore(store, 3000)).toEqual(legacy);
	expect(closestSnapshotBefore(store, 3000, scope)).toEqual(extended);
	expect(shouldCapture(store, 3000, { attachments: false, unresolved: true })).toBe(true);
	expect(shouldCapture(store, 3000, scope)).toBe(false);
});
test("old snapshots remain exact and malformed explicit scopes are not treated as legacy", () => {
	const normalized = normalizeSnapshotStore({ version: 1, snapshots: [legacy, extended, { ...legacy, scope: { attachments: "yes" } }] });
	expect(normalized?.snapshots).toEqual([legacy, extended]);
});
test("retention preserves independent baselines within a shared time bucket", () => {
	const result = applyRetention({ version: 1, snapshots: [legacy, extended] }, 3000);
	expect(result.snapshots).toEqual([legacy, extended]);
});
