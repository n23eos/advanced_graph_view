/**
 * Search query syntax, superset of the core graph filter:
 *   path:notes tag:#idea file:daily -tag:done "точная фраза"
 *   opened:>10 opened:30d>5 edited:<30d created:>2024-01-01
 *   links:>5 inlinks:0 outlinks:>2 unresolved:>0 cluster:"имя"
 * Terms are AND-ed; "-" negates a term. Unknown operators degrade to
 * plain-text search so typos never nuke the whole graph.
 */
import type { NodeFacts } from "../encoding/metrics";

type Comparator = ">" | ">=" | "<" | "<=" | "=";

interface NumericCondition {
	comparator: Comparator;
	value: number;
}

export type QueryTerm =
	| { kind: "text"; needle: string }
	| { kind: "content"; needle: string }
	| { kind: "path"; needle: string }
	| { kind: "file"; needle: string }
	| { kind: "tag"; needle: string }
	| { kind: "cluster"; needle: string }
	| { kind: "opened"; windowDays: number | null; condition: NumericCondition }
	| { kind: "links"; field: "total" | "in" | "out" | "unresolved"; condition: NumericCondition }
	| { kind: "edited-days"; comparator: Comparator; days: number }
	| { kind: "created-days"; comparator: Comparator; days: number }
	| { kind: "edited-date"; comparator: Comparator; ts: number }
	| { kind: "created-date"; comparator: Comparator; ts: number };

export interface ParsedTerm {
	negated: boolean;
	term: QueryTerm;
}

export type ParsedQuery = ParsedTerm[];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Split on whitespace, keeping quoted segments (also after "key:") intact. */
function tokenize(query: string): string[] {
	const tokens: string[] = [];
	const re = /(-?)([\p{L}\p{N}_]+:)?"([^"]*)"|(\S+)/gu;
	let m: RegExpExecArray | null;
	while ((m = re.exec(query)) !== null) {
		if (m[3] !== undefined) tokens.push(`${m[1]}${m[2] ?? ""}${m[3]}`);
		else tokens.push(m[4]);
	}
	return tokens;
}

function parseCondition(raw: string): NumericCondition | null {
	const m = raw.match(/^(>=|<=|>|<|=)?(\d+)$/);
	if (!m) return null;
	return { comparator: (m[1] as Comparator) ?? "=", value: Number(m[2]) };
}

function compare(actual: number, condition: NumericCondition): boolean {
	switch (condition.comparator) {
		case ">": return actual > condition.value;
		case ">=": return actual >= condition.value;
		case "<": return actual < condition.value;
		case "<=": return actual <= condition.value;
		case "=": return actual === condition.value;
	}
}

/** "<30d" → {comparator:"<", days:30}; ">2024-01-01" → date ts. */
function parseDateArg(raw: string): { comparator: Comparator; days?: number; ts?: number } | null {
	const m = raw.match(/^(>=|<=|>|<|=)?(.+)$/);
	if (!m) return null;
	const comparator = (m[1] as Comparator) ?? "=";
	const rest = m[2];
	const daysMatch = rest.match(/^(\d+)d$/);
	if (daysMatch) return { comparator, days: Number(daysMatch[1]) };
	const ts = Date.parse(rest);
	if (!Number.isNaN(ts)) return { comparator, ts };
	return null;
}

function parseToken(token: string): ParsedTerm {
	let negated = false;
	let body = token;
	if (body.startsWith("-") && body.length > 1) {
		negated = true;
		body = body.slice(1);
	}

	const colon = body.indexOf(":");
	const asText: ParsedTerm = { negated, term: { kind: "text", needle: body.toLowerCase() } };
	if (colon <= 0) return asText;

	const key = body.slice(0, colon).toLowerCase();
	const arg = body.slice(colon + 1);
	if (!arg) return asText;

	switch (key) {
		case "content":
		case "слово":
			return { negated, term: { kind: "content", needle: arg.toLowerCase() } };
		case "path": return { negated, term: { kind: "path", needle: arg.toLowerCase() } };
		case "file": return { negated, term: { kind: "file", needle: arg.toLowerCase() } };
		case "tag": return { negated, term: { kind: "tag", needle: arg.replace(/^#/, "").toLowerCase() } };
		case "cluster": return { negated, term: { kind: "cluster", needle: arg.toLowerCase() } };
		case "opened": {
			// opened:>10  |  opened:30d>5
			const windowed = arg.match(/^(\d+)d(>=|<=|>|<|=)?(\d+)$/);
			if (windowed) {
				return {
					negated,
					term: {
						kind: "opened",
						windowDays: Number(windowed[1]),
						condition: { comparator: (windowed[2] as Comparator) ?? "=", value: Number(windowed[3]) },
					},
				};
			}
			const condition = parseCondition(arg);
			if (condition) return { negated, term: { kind: "opened", windowDays: null, condition } };
			return asText;
		}
		case "links":
		case "inlinks":
		case "outlinks":
		case "unresolved": {
			const condition = parseCondition(arg);
			if (!condition) return asText;
			const field = key === "links" ? "total" : key === "inlinks" ? "in" : key === "outlinks" ? "out" : "unresolved";
			return { negated, term: { kind: "links", field, condition } };
		}
		case "edited":
		case "created": {
			const parsed = parseDateArg(arg);
			if (!parsed) return asText;
			if (parsed.days !== undefined) {
				return {
					negated,
					term: { kind: key === "edited" ? "edited-days" : "created-days", comparator: parsed.comparator, days: parsed.days },
				};
			}
			return {
				negated,
				term: { kind: key === "edited" ? "edited-date" : "created-date", comparator: parsed.comparator, ts: parsed.ts! },
			};
		}
		default:
			return asText;
	}
}

export function parseQuery(query: string): ParsedQuery {
	return tokenize(query.trim()).map(parseToken);
}

function windowOpens(facts: NodeFacts, windowDays: number): number {
	if (windowDays <= 7) return facts.opens7;
	if (windowDays <= 30) return facts.opens30;
	return facts.opens90;
}

export type ContentMatcher = (needle: string, path: string) => boolean;

function termMatches(
	term: QueryTerm,
	facts: NodeFacts,
	now: number,
	contentMatcher?: ContentMatcher
): boolean {
	switch (term.kind) {
		case "text": {
			const needle = term.needle;
			return facts.path.toLowerCase().includes(needle);
		}
		case "content":
			// Without a resolver (content index still loading) the term is
			// non-restrictive so typing doesn't blank the graph.
			return contentMatcher ? contentMatcher(term.needle, facts.path) : true;
		case "path":
			return facts.path.toLowerCase().includes(term.needle);
		case "file": {
			const name = facts.path.slice(facts.path.lastIndexOf("/") + 1).toLowerCase();
			return name.includes(term.needle);
		}
		case "tag":
			return facts.tags.some((tag) => {
				const lower = tag.toLowerCase();
				return lower === term.needle || lower.startsWith(`${term.needle}/`);
			});
		case "cluster":
			return facts.cluster.toLowerCase().includes(term.needle);
		case "opened": {
			const actual = term.windowDays === null ? facts.opensTotal : windowOpens(facts, term.windowDays);
			return compare(actual, term.condition);
		}
		case "links": {
			const actual =
				term.field === "total" ? facts.inCount + facts.outCount :
				term.field === "in" ? facts.inCount :
				term.field === "out" ? facts.outCount :
				facts.unresolvedCount;
			return compare(actual, term.condition);
		}
		case "edited-days": {
			const daysAgo = (now - facts.mtime) / DAY_MS;
			return compare(daysAgo, { comparator: term.comparator, value: term.days });
		}
		case "created-days": {
			const daysAgo = (now - facts.ctime) / DAY_MS;
			return compare(daysAgo, { comparator: term.comparator, value: term.days });
		}
		case "edited-date":
			return compare(facts.mtime, { comparator: term.comparator, value: term.ts });
		case "created-date":
			return compare(facts.ctime, { comparator: term.comparator, value: term.ts });
	}
}

export function matchesQuery(
	query: ParsedQuery,
	facts: NodeFacts,
	now: number,
	contentMatcher?: ContentMatcher
): boolean {
	for (const { negated, term } of query) {
		const matched = termMatches(term, facts, now, contentMatcher);
		if (negated ? matched : !matched) return false;
	}
	return true;
}

/** Content-search needles present in the query (for async index building). */
export function contentNeedles(query: ParsedQuery): string[] {
	return query
		.filter((t) => t.term.kind === "content")
		.map((t) => (t.term as { needle: string }).needle);
}
