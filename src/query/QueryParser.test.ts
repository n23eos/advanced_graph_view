import { describe, expect, test } from "vitest";
import { parseQuery, matchesQuery } from "./QueryParser";
import type { NodeFacts } from "../encoding/metrics";

const NOW = new Date("2026-07-19T12:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function facts(overrides: Partial<NodeFacts>): NodeFacts {
	return {
		path: "notes/idea.md",
		folder: "notes",
		tags: [],
		inCount: 0,
		outCount: 0,
		unresolvedCount: 0,
		ctime: NOW - 100 * DAY_MS,
		mtime: NOW - 10 * DAY_MS,
		size: 100,
		opensTotal: 0,
		pagerank: 0,
		cluster: "",
		opens7: 0,
		opens30: 0,
		opens90: 0,
		...overrides,
	};
}

function match(query: string, f: NodeFacts): boolean {
	return matchesQuery(parseQuery(query), f, NOW);
}

describe("plain text", () => {
	test("substring match on name, case-insensitive", () => {
		expect(match("Idea", facts({}))).toBe(true);
		expect(match("banana", facts({}))).toBe(false);
	});

	test("quoted phrase matches path", () => {
		expect(match('"notes/idea"', facts({}))).toBe(true);
	});

	test("multiple terms are AND", () => {
		expect(match("idea notes", facts({}))).toBe(true);
		expect(match("idea banana", facts({}))).toBe(false);
	});
});

describe("field operators", () => {
	test("path: prefix filter", () => {
		expect(match("path:notes", facts({}))).toBe(true);
		expect(match("path:projects", facts({}))).toBe(false);
	});

	test("tag: matches tag and nested tags", () => {
		const f = facts({ tags: ["work/deep", "idea"] });
		expect(match("tag:work", f)).toBe(true);
		expect(match("tag:idea", f)).toBe(true);
		expect(match("tag:play", f)).toBe(false);
	});

	test("tag: accepts leading #", () => {
		expect(match("tag:#idea", facts({ tags: ["idea"] }))).toBe(true);
	});

	test("file: substring on file name", () => {
		expect(match("file:idea", facts({}))).toBe(true);
		expect(match("file:notes", facts({}))).toBe(false); // folder, not file name
	});

	test('cluster:"имя" matches cluster name', () => {
		expect(match('cluster:"python · скрипты"', facts({ cluster: "python · скрипты" }))).toBe(true);
		expect(match('cluster:python', facts({ cluster: "python · скрипты" }))).toBe(true);
	});

	test("negation excludes matches", () => {
		expect(match("-path:notes", facts({}))).toBe(false);
		expect(match("idea -tag:done", facts({ tags: ["done"] }))).toBe(false);
		expect(match("idea -tag:done", facts({}))).toBe(true);
	});
});

describe("numeric operators", () => {
	test("opened:>N uses total opens", () => {
		expect(match("opened:>10", facts({ opensTotal: 11 }))).toBe(true);
		expect(match("opened:>10", facts({ opensTotal: 10 }))).toBe(false);
	});

	test("opened:30d>5 uses the 30-day window", () => {
		expect(match("opened:30d>5", facts({ opens30: 6 }))).toBe(true);
		expect(match("opened:30d>5", facts({ opens30: 5, opensTotal: 100 }))).toBe(false);
	});

	test("links: totals, inlinks:0 finds orphans", () => {
		expect(match("links:>5", facts({ inCount: 3, outCount: 3 }))).toBe(true);
		expect(match("inlinks:0", facts({ inCount: 0 }))).toBe(true);
		expect(match("inlinks:0", facts({ inCount: 2 }))).toBe(false);
	});

	test("unresolved:>0 finds broken links", () => {
		expect(match("unresolved:>0", facts({ unresolvedCount: 1 }))).toBe(true);
		expect(match("unresolved:>0", facts({}))).toBe(false);
	});
});

describe("date operators", () => {
	test("edited:<30d means edited within the last 30 days", () => {
		expect(match("edited:<30d", facts({ mtime: NOW - 10 * DAY_MS }))).toBe(true);
		expect(match("edited:<30d", facts({ mtime: NOW - 40 * DAY_MS }))).toBe(false);
	});

	test("edited:>30d means edited longer ago", () => {
		expect(match("edited:>30d", facts({ mtime: NOW - 40 * DAY_MS }))).toBe(true);
	});

	test("created:>date compares absolute dates", () => {
		expect(match("created:>2026-01-01", facts({ ctime: NOW - 10 * DAY_MS }))).toBe(true);
		expect(match("created:>2026-01-01", facts({ ctime: new Date("2025-06-01").getTime() }))).toBe(false);
	});
});

describe("edge cases", () => {
	test("empty query matches everything", () => {
		expect(match("", facts({}))).toBe(true);
		expect(match("   ", facts({}))).toBe(true);
	});

	test("unknown operator falls back to text search", () => {
		expect(match("weird:stuff", facts({ path: "weird:stuff.md" }))).toBe(true);
	});
});

describe("content operator", () => {
	test("content term uses the provided matcher", () => {
		const q = parseQuery("content:кибернетика");
		const yes = matchesQuery(q, facts({}), NOW, (needle, path) => needle === "кибернетика" && path === "notes/idea.md");
		const no = matchesQuery(q, facts({}), NOW, () => false);
		expect(yes).toBe(true);
		expect(no).toBe(false);
	});

	test("content term without matcher is non-restrictive", () => {
		expect(matchesQuery(parseQuery("content:xyz"), facts({}), NOW)).toBe(true);
	});

	test("russian alias слово: works", () => {
		const q = parseQuery("слово:тест");
		expect(matchesQuery(q, facts({}), NOW, (n) => n === "тест")).toBe(true);
	});
});
