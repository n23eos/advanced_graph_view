import { describe, expect, test } from "vitest";
import { computeTopologyDiff, coolingClusters, notesChangedSince } from "./graphChanges";
import type { GraphModel } from "../data/GraphStore";
import type { GraphSnapshot } from "../data/graphSnapshots";
import type { UsageLog } from "../data/UsageTracker";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 17);

const modelOf = (paths: string[], edges: [number, number][], inCounts?: number[]): GraphModel => ({
	nodes: paths.map((path, id) => ({
		id,
		path,
		name: path.replace(/\.md$/, ""),
		inCount: inCounts?.[id] ?? edges.filter(([, t]) => t === id).length,
		outCount: edges.filter(([s]) => s === id).length,
		unresolvedCount: 0,
	})),
	edges: edges.map(([source, target]) => ({ source, target, weight: 1 })),
	pathToId: new Map(paths.map((path, id) => [path, id])),
});

const snapshotOf = (paths: string[], edges: [number, number][], pagerank?: number[]): GraphSnapshot => ({
	version: 1,
	capturedAt: NOW - 10 * DAY,
	paths,
	edges,
	pagerank: pagerank ?? paths.map(() => 0.1),
});

describe("computeTopologyDiff (F-10)", () => {
	test("finds added and removed links by path", () => {
		const snapshot = snapshotOf(["a.md", "b.md", "c.md"], [[0, 1], [1, 2]]);
		const model = modelOf(["a.md", "b.md", "c.md"], [[0, 1], [0, 2]]);
		const diff = computeTopologyDiff(snapshot, model, null);
		expect(diff.addedLinks).toEqual([{ fromPath: "a.md", toPath: "c.md" }]);
		expect(diff.removedLinks).toEqual([{ fromPath: "b.md", toPath: "c.md" }]);
	});

	test("a renamed note reads as removed plus added links", () => {
		const snapshot = snapshotOf(["old.md", "b.md"], [[0, 1]]);
		const model = modelOf(["new.md", "b.md"], [[0, 1]]);
		const diff = computeTopologyDiff(snapshot, model, null);
		expect(diff.addedLinks).toEqual([{ fromPath: "new.md", toPath: "b.md" }]);
		expect(diff.removedLinks).toEqual([{ fromPath: "old.md", toPath: "b.md" }]);
	});

	test("growing hubs: top movers by inbound growth, positive delta only", () => {
		const paths = Array.from({ length: 20 }, (_, i) => `n${String(i).padStart(2, "0")}.md`);
		const snapshot = snapshotOf(paths, []);
		// n00 gained 5 inbound links, n01 gained 1, the rest none.
		const inCounts = paths.map((_, i) => (i === 0 ? 5 : i === 1 ? 1 : 0));
		const model = modelOf(paths, [], inCounts);
		const diff = computeTopologyDiff(snapshot, model, null);
		expect(diff.growingHubs).toEqual(["n00.md"]);
	});

	test("pagerank deltas count even without inbound growth", () => {
		const snapshot = snapshotOf(["a.md", "b.md"], [], [0.1, 0.1]);
		const model = modelOf(["a.md", "b.md"], []);
		const diff = computeTopologyDiff(snapshot, model, new Float32Array([0.5, 0.1]));
		expect(diff.growingHubs).toEqual(["a.md"]);
	});

	test("a brand-new note is never a growing hub", () => {
		const snapshot = snapshotOf(["a.md"], []);
		const model = modelOf(["a.md", "fresh.md"], [], [0, 9]);
		expect(computeTopologyDiff(snapshot, model, null).growingHubs).toEqual([]);
	});
});

describe("notesChangedSince", () => {
	test("splits new from edited by ctime/mtime", () => {
		const nodes = [
			{ path: "new.md", ctime: NOW - DAY, mtime: NOW - DAY },
			{ path: "edited.md", ctime: NOW - 90 * DAY, mtime: NOW - 2 * DAY },
			{ path: "old.md", ctime: NOW - 90 * DAY, mtime: NOW - 60 * DAY },
		];
		const { newNotes, editedNotes } = notesChangedSince(nodes, NOW - 7 * DAY);
		expect(newNotes).toEqual(["new.md"]);
		expect(editedNotes).toEqual(["edited.md"]);
	});
});

describe("coolingClusters", () => {
	const day = (offset: number) => new Date(NOW - offset * DAY).toISOString().slice(0, 10);
	const usageOf = (days: Record<string, number>): UsageLog[string] => ({
		total: Object.values(days).reduce((a, b) => a + b, 0),
		days,
		months: {},
		years: {},
	});

	test("a cluster that halved its opens after a busy window is cooling", () => {
		const model = modelOf(["a.md", "b.md"], []);
		const usage: UsageLog = {
			// Previous 7-day window: 6 opens; current window: 2.
			"a.md": usageOf({ [day(10)]: 6, [day(2)]: 2 }),
		};
		const cooling = coolingClusters(usage, model, new Int32Array([0, 1]), 2, 7, NOW);
		expect(cooling).toEqual([0]);
	});

	test("quiet clusters (previous < 5 opens) never count", () => {
		const model = modelOf(["a.md"], []);
		const usage: UsageLog = { "a.md": usageOf({ [day(10)]: 4 }) };
		expect(coolingClusters(usage, model, new Int32Array([0]), 1, 7, NOW)).toEqual([]);
	});

	test("a still-busy cluster is not cooling", () => {
		const model = modelOf(["a.md"], []);
		const usage: UsageLog = { "a.md": usageOf({ [day(10)]: 6, [day(2)]: 4 }) };
		expect(coolingClusters(usage, model, new Int32Array([0]), 1, 7, NOW)).toEqual([]);
	});
});
