import { describe, expect, test } from "vitest";
import {
	compactLog,
	countRecentOpens,
	emptyLog,
	pushSessionEntry,
	recordOpen,
	removePath,
	renamePath,
	type UsageLog,
} from "./UsageTracker";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-19T12:00:00Z").getTime();

describe("recordOpen", () => {
	test("increments total and the day bucket", () => {
		// Arrange
		const log = emptyLog();

		// Act
		const once = recordOpen(log, "a.md", NOW);
		const twice = recordOpen(once, "a.md", NOW);

		// Assert
		expect(twice["a.md"].total).toBe(2);
		expect(twice["a.md"].days["2026-07-19"]).toBe(2);
	});

	test("does not mutate the previous log", () => {
		// Arrange
		const log = emptyLog();

		// Act
		const next = recordOpen(log, "a.md", NOW);

		// Assert
		expect(log["a.md"]).toBeUndefined();
		expect(next["a.md"].total).toBe(1);
	});

	test("tracks separate paths independently", () => {
		// Arrange & Act
		let log = emptyLog();
		log = recordOpen(log, "a.md", NOW);
		log = recordOpen(log, "b.md", NOW);

		// Assert
		expect(log["a.md"].total).toBe(1);
		expect(log["b.md"].total).toBe(1);
	});
});

describe("countRecentOpens", () => {
	test("sums opens within the window and ignores older days", () => {
		// Arrange
		let log = emptyLog();
		log = recordOpen(log, "a.md", NOW);
		log = recordOpen(log, "a.md", NOW - 5 * DAY_MS);
		log = recordOpen(log, "a.md", NOW - 40 * DAY_MS);

		// Act & Assert
		expect(countRecentOpens(log, "a.md", 7, NOW)).toBe(2);
		expect(countRecentOpens(log, "a.md", 90, NOW)).toBe(3);
	});

	test("returns 0 for unknown path", () => {
		expect(countRecentOpens(emptyLog(), "nope.md", 30, NOW)).toBe(0);
	});
});

describe("compactLog", () => {
	test("folds days older than 90 days into monthly buckets", () => {
		// Arrange
		let log = emptyLog();
		log = recordOpen(log, "a.md", NOW - 100 * DAY_MS); // 2026-04-10
		log = recordOpen(log, "a.md", NOW - 101 * DAY_MS); // 2026-04-09
		log = recordOpen(log, "a.md", NOW); // stays daily

		// Act
		const compacted = compactLog(log, NOW);

		// Assert
		expect(compacted["a.md"].days["2026-07-19"]).toBe(1);
		expect(compacted["a.md"].months["2026-04"]).toBe(2);
		expect(Object.keys(compacted["a.md"].days)).toHaveLength(1);
		expect(compacted["a.md"].total).toBe(3);
	});

	test("folds months older than 2 years into yearly buckets", () => {
		// Arrange
		let log = emptyLog();
		log = recordOpen(log, "a.md", NOW - 800 * DAY_MS); // 2024-05-11
		const monthly = compactLog(log, NOW - 700 * DAY_MS); // becomes a month bucket

		// Act
		const compacted = compactLog(monthly, NOW);

		// Assert
		expect(compacted["a.md"].years["2024"]).toBe(1);
		expect(Object.keys(compacted["a.md"].months)).toHaveLength(0);
		expect(compacted["a.md"].total).toBe(1);
	});
});

describe("rename and remove", () => {
	test("rename moves history to the new path", () => {
		// Arrange
		let log = emptyLog();
		log = recordOpen(log, "old.md", NOW);

		// Act
		const renamed = renamePath(log, "old.md", "new.md");

		// Assert
		expect(renamed["old.md"]).toBeUndefined();
		expect(renamed["new.md"].total).toBe(1);
	});

	test("remove drops the entry", () => {
		// Arrange
		let log: UsageLog = emptyLog();
		log = recordOpen(log, "a.md", NOW);

		// Act
		const removed = removePath(log, "a.md");

		// Assert
		expect(removed["a.md"]).toBeUndefined();
	});
});

describe("pushSessionEntry", () => {
	test("appends entries and caps the trail length", () => {
		// Arrange
		let trail: { path: string; ts: number }[] = [];

		// Act
		for (let i = 0; i < 250; i++) {
			trail = pushSessionEntry(trail, { path: `n${i}.md`, ts: NOW + i }, 200);
		}

		// Assert
		expect(trail).toHaveLength(200);
		expect(trail[0].path).toBe("n50.md"); // oldest 50 dropped
		expect(trail[199].path).toBe("n249.md");
	});
});
