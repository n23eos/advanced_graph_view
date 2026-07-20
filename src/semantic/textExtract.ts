/** Note text → embedding input: title + cleaned body, capped length. */

const BODY_LIMIT = 1500;

export function extractEmbeddingText(title: string, rawBody: string): string {
	const body = rawBody
		.replace(/^---\n[\s\S]*?\n---\n?/, "") // frontmatter
		.replace(/```[\s\S]*?```/g, " ") // fenced code blocks
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, BODY_LIMIT);
	return `${title}. ${body}`;
}

/** djb2 — fast change detector for incremental re-indexing. */
export function contentHash(text: string): number {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	}
	return hash >>> 0;
}
