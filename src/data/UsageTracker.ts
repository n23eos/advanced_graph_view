/**
 * Usage log: pure, immutable operations over open-count statistics.
 * Day-level buckets compact into months after 90 days, months into years
 * after 2 years, so the file stays small on old vaults.
 * Obsidian event wiring lives in main.ts; this module is unit-tested alone.
 */

export interface PathUsage {
	total: number;
	days: Record<string, number>;
	months: Record<string, number>;
	years: Record<string, number>;
}

export type UsageLog = Record<string, PathUsage>;

export interface SessionEntry {
	path: string;
	ts: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const DAILY_RETENTION_DAYS = 90;
export const MONTHLY_RETENTION_DAYS = 730;

export function emptyLog(): UsageLog {
	return {};
}

/**
 * Validate a usage.json that was written by an older version, edited by hand,
 * or truncated by a crash. A single bad entry must not take the whole history
 * with it, so entries are repaired where possible and dropped where not;
 * `null` means the file is not a log at all and should be replaced.
 */
export function normalizeUsageLog(raw: unknown): UsageLog | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

	const log: UsageLog = {};
	for (const [path, value] of Object.entries(raw)) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const usage = value as Partial<PathUsage>;
		log[path] = {
			total: countOrZero(usage.total),
			days: numericBuckets(usage.days),
			months: numericBuckets(usage.months),
			years: numericBuckets(usage.years),
		};
	}
	return log;
}

/** Counts must be finite non-negative numbers — anything else reads as zero. */
function countOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Keeps only the date→count pairs that survive `countOrZero` unchanged. */
function numericBuckets(raw: unknown): Record<string, number> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const buckets: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw)) {
		const count = countOrZero(value);
		if (count > 0) buckets[key] = count;
	}
	return buckets;
}

function dayKey(ts: number): string {
	return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
}

function emptyUsage(): PathUsage {
	return { total: 0, days: {}, months: {}, years: {} };
}

export function recordOpen(log: UsageLog, path: string, ts: number): UsageLog {
	const previous = log[path] ?? emptyUsage();
	const key = dayKey(ts);
	return {
		...log,
		[path]: {
			...previous,
			total: previous.total + 1,
			days: { ...previous.days, [key]: (previous.days[key] ?? 0) + 1 },
		},
	};
}

/** Sum of opens over the last `windowDays` days (window fits daily retention). */
export function countRecentOpens(log: UsageLog, path: string, windowDays: number, now: number): number {
	const usage = log[path];
	if (!usage) return 0;
	const cutoff = dayKey(now - windowDays * DAY_MS);
	let count = 0;
	for (const [day, opens] of Object.entries(usage.days)) {
		if (day >= cutoff) count += opens;
	}
	return count;
}

export function compactLog(log: UsageLog, now: number): UsageLog {
	const dailyCutoff = dayKey(now - DAILY_RETENTION_DAYS * DAY_MS);
	const yearlyCutoff = dayKey(now - MONTHLY_RETENTION_DAYS * DAY_MS).slice(0, 7);

	const result: UsageLog = {};
	for (const [path, usage] of Object.entries(log)) {
		const days: Record<string, number> = {};
		const months: Record<string, number> = { ...usage.months };
		const years: Record<string, number> = { ...usage.years };

		for (const [day, opens] of Object.entries(usage.days)) {
			if (day >= dailyCutoff) {
				days[day] = opens;
			} else {
				const month = day.slice(0, 7);
				months[month] = (months[month] ?? 0) + opens;
			}
		}
		for (const month of Object.keys(months)) {
			if (month < yearlyCutoff) {
				const year = month.slice(0, 4);
				years[year] = (years[year] ?? 0) + months[month];
				delete months[month];
			}
		}
		result[path] = { total: usage.total, days, months, years };
	}
	return result;
}

export function renamePath(log: UsageLog, oldPath: string, newPath: string): UsageLog {
	const usage = log[oldPath];
	if (!usage) return log;
	const next = { ...log };
	delete next[oldPath];
	next[newPath] = usage;
	return next;
}

export function removePath(log: UsageLog, path: string): UsageLog {
	if (!log[path]) return log;
	const next = { ...log };
	delete next[path];
	return next;
}

export function pushSessionEntry(
	trail: readonly SessionEntry[],
	entry: SessionEntry,
	cap: number
): SessionEntry[] {
	const next = [...trail, entry];
	return next.length > cap ? next.slice(next.length - cap) : next;
}
