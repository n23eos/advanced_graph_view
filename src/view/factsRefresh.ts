import type { NodeFacts } from "../encoding/metrics";

/** Only used when the graph model and its node ids are unchanged. */
export function carryMetrics(prev: readonly NodeFacts[], next: readonly NodeFacts[]): NodeFacts[] {
	return next.map((fact, id) => ({
		...fact,
		pagerank: prev[id]?.pagerank ?? fact.pagerank,
		cluster: prev[id]?.cluster ?? fact.cluster,
	}));
}

export function diffFacts(prev: readonly NodeFacts[], next: readonly NodeFacts[]): { changed: boolean; groupingChanged: boolean } {
	let changed = prev.length !== next.length;
	let groupingChanged = changed;
	for (let id = 0; id < next.length; id++) {
		const before = prev[id];
		const after = next[id];
		if (!before) return { changed: true, groupingChanged: true };
		if (before.folder !== after.folder || before.tags.length !== after.tags.length ||
			after.tags.some((tag, index) => tag !== before.tags[index])) {
			groupingChanged = true;
			changed = true;
		}
		for (const key of Object.keys(after) as (keyof NodeFacts)[]) {
			if (key !== "tags" && before[key] !== after[key]) changed = true;
		}
	}
	return { changed, groupingChanged };
}
