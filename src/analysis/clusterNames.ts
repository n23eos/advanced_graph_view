/**
 * Offline cluster naming: top TF-IDF terms from note titles + dominant tag.
 * No LLM, no network — a rough but useful label. Full-text naming can
 * replace this once Phase 5 adds note content access.
 */

export interface ClusterContent {
	titles: string[];
	tags: string[];
}

const STOP_WORDS = new Set([
	// ru
	"и", "в", "на", "не", "что", "как", "это", "для", "про", "или", "все",
	"еще", "уже", "так", "его", "она", "они", "оно", "мой", "наш", "ваш",
	"год", "год", "она", "быть", "если", "чтобы", "также", "может", "тем",
	// en
	"the", "and", "for", "with", "from", "that", "this", "are", "was",
	"you", "your", "have", "has", "not", "but", "all", "can", "how",
	"what", "when", "where", "notes", "note",
]);

const TERMS_PER_CLUSTER = 3;
const MIN_TERM_LENGTH = 3;

function tokenize(title: string): string[] {
	return title
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((term) => term.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(term));
}

export function nameClusters(clusters: readonly ClusterContent[]): string[] {
	// Document frequency: in how many clusters does each term appear.
	const clusterTerms = clusters.map((cluster) => {
		const counts = new Map<string, number>();
		for (const title of cluster.titles) {
			for (const term of tokenize(title)) {
				counts.set(term, (counts.get(term) ?? 0) + 1);
			}
		}
		return counts;
	});

	const documentFrequency = new Map<string, number>();
	for (const counts of clusterTerms) {
		for (const term of counts.keys()) {
			documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
		}
	}

	return clusters.map((cluster, index) => {
		const counts = clusterTerms[index];
		const scored = [...counts.entries()].map(([term, tf]) => {
			const df = documentFrequency.get(term) ?? 1;
			const idf = Math.log((1 + clusters.length) / df);
			return { term, score: tf * idf };
		});
		scored.sort((a, b) => b.score - a.score);
		const terms = scored.slice(0, TERMS_PER_CLUSTER).map((s) => s.term);

		const tagCounts = new Map<string, number>();
		for (const tag of cluster.tags) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
		const topTag = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

		const parts: string[] = [];
		if (topTag) parts.push(`#${topTag}`);
		parts.push(...terms);
		return parts.length > 0 ? parts.join(" · ") : `Cluster ${index + 1}`;
	});
}
