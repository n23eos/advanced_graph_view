/**
 * Reduce Markdown to readable prose for the hover preview: drop the syntax
 * (headings, emphasis, list bullets, code fences) but keep the words a reader
 * cares about, including link and wikilink display text.
 */
export function stripMarkdown(input: string): string {
	return (
		input
			// Fenced code blocks — drop the whole block, it rarely reads as prose.
			.replace(/```[\s\S]*?```/g, " ")
			// Inline code — keep the code text, drop the backticks.
			.replace(/`([^`]+)`/g, "$1")
			// Images: ![alt](url) — remove entirely.
			.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
			// Links: [text](url) — keep the text.
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			// Wikilinks: [[target|alias]] or [[target]] — keep the visible part.
			.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1")
			// HTML tags.
			.replace(/<[^>]+>/g, " ")
			// Line-leading markers: headings, blockquotes, list bullets, numbers.
			.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
			// Emphasis / strikethrough / highlight markers.
			.replace(/(\*\*|__|\*|_|~~|==)/g, "")
			.trim()
	);
}
