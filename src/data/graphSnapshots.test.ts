import { describe, expect, test } from "vitest";
import {
	applyRetention,
	buildSnapshot,
	closestSnapshotBefore,
	emptySnapshotStore,
	normalizeSnapshotStore,
	shouldCapture,
	type GraphSnapshot,
	type SnapshotStore,
} from "./graphSnapshots";
import type { GraphModel } from "./GraphStore";
import type { GraphMetrics } from "../workers/MetricsClient";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_755_000_000_000;

const snap = (capturedAt: number, paths: string[] = ["a.md"]): GraphSnapshot => ({
	version: 1,
	capturedAt,
	paths,
	edges: [],
	pagerank: paths.map(() => 0),
});

const store = (...snapshots: GraphSnapshot[]): SnapshotStore => ({ version: 1, snapshots });

describe("buildSnapshot (F-10)", () => {
	test("captures paths, index edges and metrics", () => {
		const model: GraphModel = {
			nodes: [
				{ id: 0, path: "a.md", name: "a", inCount: 0, outCount: 1, unresolvedCount: 0 },
				{ id: 1, path: "b.md", name: "b", inCount: 1, outCount: 0, unresolvedCount: 0 },
			],
			edges: [{ source: 0, target: 1, weight: 1 }],
			pathToId: new Map(),
		};
		const metrics: GraphMetrics = {
			pagerank: new Float32Array([0.25, 0.75]),
			community: new Int32Array([0, 0]),
			communityCount: 1,
		};
		const snapshot = buildSnapshot(model, metrics, NOW);
		expect(snapshot.paths).toEqual(["a.md", "b.md"]);
		expect(snapshot.edges).toEqual([[0, 1]]);
		expect(snapshot.pagerank[1]).toBeCloseTo(0.75);
		expect(snapshot.communityByPath).toEqual([0, 0]);
	});
});

describe("shouldCapture", () => {
	test("first snapshot always allowed; then at most one per 24h", () => {
		expect(shouldCapture(emptySnapshotStore(), NOW)).toBe(true);
		expect(shouldCapture(store(snap(NOW - DAY / 2)), NOW)).toBe(false);
		expect(shouldCapture(store(snap(NOW - DAY)), NOW)).toBe(true);
	});
});

describe("closestSnapshotBefore", () => {
	test("newest snapshot not newer than the period start wins", () => {
		const s = store(snap(NOW - 40 * DAY), snap(NOW - 10 * DAY), snap(NOW - 2 * DAY));
		expect(closestSnapshotBefore(s, NOW - 7 * DAY)?.capturedAt).toBe(NOW - 10 * DAY);
		expect(closestSnapshotBefore(s, NOW - 60 * DAY)).toBeNull();
	});
});

describe("applyRetention", () => {
	test("keeps one snapshot per week for eight weeks, then monthly", () => {
		const daily = Array.from({ length: 100 }, (_, i) => snap(NOW - i * DAY));
		const kept = applyRetention(store(...daily), NOW);
		expect(kept.snapshots.length).toBeLessThanOrEqual(WEEKLY_AND_MONTHLY_MAX);
		// The newest snapshot always survives.
		expect(kept.snapshots[kept.snapshots.length - 1].capturedAt).toBe(NOW);
	});

	test("ancient snapshots beyond the monthly window are dropped", () => {
		const ancient = snap(NOW - 400 * DAY);
		const kept = applyRetention(store(ancient, snap(NOW)), NOW);
		expect(kept.snapshots.some((s) => s.capturedAt === ancient.capturedAt)).toBe(false);
	});
});

const WEEKLY_AND_MONTHLY_MAX = 8 + 6 + 1;

describe("normalizeSnapshotStore", () => {
	test("accepts its own output and drops broken rows", () => {
		const good = store(snap(NOW));
		expect(normalizeSnapshotStore(JSON.parse(JSON.stringify(good)))).toEqual(good);
		const mixed = { version: 1, snapshots: [snap(NOW), { junk: true }, null] };
		expect(normalizeSnapshotStore(mixed)?.snapshots).toHaveLength(1);
	});

	test("rejects non-stores so the caller can quarantine the file", () => {
		expect(normalizeSnapshotStore(null)).toBeNull();
		expect(normalizeSnapshotStore([1, 2])).toBeNull();
		expect(normalizeSnapshotStore({ version: 2, snapshots: [] })).toBeNull();
	});
});
