/**
 * F-10: periodic topology snapshots the "What changed?" panel diffs against.
 * Pure data + policy — persistence lives in PluginDataStore, capture timing
 * in main.ts. Nodes travel as vault paths so a snapshot survives rebuilds;
 * a renamed note simply reads as removed + added (§13.3).
 */
import type { GraphModel } from "./GraphStore";
import type { GraphMetrics } from "../workers/MetricsClient";

export interface GraphSnapshot {
	version: 1;
	capturedAt: number;
	paths: string[];
	/** Directed edges as [sourceIndex, targetIndex] into `paths`. */
	edges: Array<[number, number]>;
	pagerank: number[];
	communityByPath?: number[];
}

export interface SnapshotStore {
	version: 1;
	snapshots: GraphSnapshot[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** ~30-day buckets are close enough for "monthly" retention. */
const MONTH_MS = 30 * DAY_MS;
export const WEEKLY_KEEP = 8;
export const MONTHLY_KEEP = 6;
export const SNAPSHOT_SIZE_CAP_BYTES = 64 * 1024 * 1024;
export const CAPTURE_MIN_INTERVAL_MS = DAY_MS;

export function emptySnapshotStore(): SnapshotStore {
	return { version: 1, snapshots: [] };
}

export function buildSnapshot(
	model: GraphModel,
	metrics: GraphMetrics,
	capturedAt: number
): GraphSnapshot {
	return {
		version: 1,
		capturedAt,
		paths: model.nodes.map((node) => node.path),
		edges: model.edges.map((edge) => [edge.source, edge.target]),
		pagerank: Array.from(metrics.pagerank),
		communityByPath: Array.from(metrics.community),
	};
}

/** At most one snapshot per 24 h, and only after metrics succeeded. */
export function shouldCapture(store: SnapshotStore, now: number): boolean {
	const latest = store.snapshots[store.snapshots.length - 1];
	return !latest || now - latest.capturedAt >= CAPTURE_MIN_INTERVAL_MS;
}

/** The snapshot the diff runs against: the newest one captured no later
 *  than the period start; null means the history does not reach that far. */
export function closestSnapshotBefore(store: SnapshotStore, periodStart: number): GraphSnapshot | null {
	let best: GraphSnapshot | null = null;
	for (const snapshot of store.snapshots) {
		if (snapshot.capturedAt <= periodStart && (!best || snapshot.capturedAt > best.capturedAt)) {
			best = snapshot;
		}
	}
	return best;
}

/**
 * Retention: within the last 8 weeks keep the newest snapshot per week,
 * older ones the newest per month up to 6 — then a hard size cap that drops
 * the oldest first. The newest snapshot (the current baseline) always stays.
 */
export function applyRetention(store: SnapshotStore, now: number): SnapshotStore {
	const sorted = [...store.snapshots].sort((a, b) => a.capturedAt - b.capturedAt);
	const newest = sorted[sorted.length - 1];
	if (!newest) return { version: 1, snapshots: [] };

	const byBucket = new Map<string, GraphSnapshot>();
	for (const snapshot of sorted) {
		const age = now - snapshot.capturedAt;
		let key: string | null = null;
		if (age <= WEEKLY_KEEP * WEEK_MS) key = `w${Math.floor(age / WEEK_MS)}`;
		else if (age <= WEEKLY_KEEP * WEEK_MS + MONTHLY_KEEP * MONTH_MS) {
			key = `m${Math.floor((age - WEEKLY_KEEP * WEEK_MS) / MONTH_MS)}`;
		}
		if (key === null) continue;
		const kept = byBucket.get(key);
		if (!kept || snapshot.capturedAt > kept.capturedAt) byBucket.set(key, snapshot);
	}
	byBucket.set("baseline", newest);

	let kept = [...new Set(byBucket.values())].sort((a, b) => a.capturedAt - b.capturedAt);

	// Hard cap by serialized size: drop the oldest, never the baseline.
	while (kept.length > 1 && JSON.stringify({ version: 1, snapshots: kept }).length > SNAPSHOT_SIZE_CAP_BYTES) {
		kept = kept.slice(1);
	}
	return { version: 1, snapshots: kept };
}

/** Corrupt-file gate for snapshots.json; null → quarantine and start over. */
export function normalizeSnapshotStore(raw: unknown): SnapshotStore | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const store = raw as Partial<SnapshotStore>;
	if (store.version !== 1 || !Array.isArray(store.snapshots)) return null;
	const rows: unknown[] = store.snapshots;
	const snapshots = rows.filter((row): row is GraphSnapshot => {
		if (typeof row !== "object" || row === null) return false;
		const snapshot = row as Partial<GraphSnapshot>;
		if (
			snapshot.version !== 1 ||
			typeof snapshot.capturedAt !== "number" ||
			!Array.isArray(snapshot.paths) ||
			!Array.isArray(snapshot.edges) ||
			!Array.isArray(snapshot.pagerank)
		) {
			return false;
		}
		// A snapshot whose edges point outside its own path table is corrupt —
		// dropping it here beats silently losing topology in the diff.
		const count = snapshot.paths.length;
		return snapshot.edges.every(
			(edge) =>
				Array.isArray(edge) &&
				Number.isInteger(edge[0]) &&
				Number.isInteger(edge[1]) &&
				edge[0] >= 0 && edge[0] < count &&
				edge[1] >= 0 && edge[1] < count
		);
	});
	return { version: 1, snapshots };
}
