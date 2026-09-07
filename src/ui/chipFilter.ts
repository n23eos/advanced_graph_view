export interface ChipFilterFacts {
	tags: readonly string[];
	folder: string;
}

export interface CompiledChipFilter {
	matches(facts: ChipFilterFacts): boolean;
}

/** Compile selections once, outside the per-node visibility loop. */
export function compileChipFilter(tags: ReadonlySet<string>, folders: ReadonlySet<string>): CompiledChipFilter {
	const tagPrefixes = [...tags];
	const folderPrefixes = [...folders];
	return {
		matches(facts): boolean {
			const tagOk = tagPrefixes.length === 0 || facts.tags.some((tag) =>
				tags.has(tag) || tagPrefixes.some((prefix) => tag.startsWith(`${prefix}/`))
			);
			const folderOk = folderPrefixes.length === 0 || folderPrefixes.some((folder) =>
				facts.folder === folder || facts.folder.startsWith(`${folder}/`)
			);
			return tagOk && folderOk;
		},
	};
}
