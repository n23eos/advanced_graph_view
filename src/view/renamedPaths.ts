/** Current path -> path in the model whose coordinates we still hold. */
export function resolvePreviousPath(path: string, renamed: ReadonlyMap<string, string>): string {
	return renamed.get(path) ?? path;
}

export function recordRename(renamed: Map<string, string>, oldPath: string, newPath: string): void {
	const original = resolvePreviousPath(oldPath, renamed);
	renamed.delete(oldPath);
	renamed.set(newPath, original);
}

export function remapPinnedPaths(paths: readonly string[], renamed: ReadonlyMap<string, string>): string[] {
	const current = new Map([...renamed].map(([next, previous]) => [previous, next]));
	return paths.map((path) => current.get(path) ?? path);
}

/** A second rename may arrive while a position read is awaiting disk. */
export function consumeRenames(pending: Map<string, string>, applied: ReadonlyMap<string, string>): void {
	const installed = new Map([...applied].map(([next, previous]) => [previous, next]));
	for (const [path, original] of pending) {
		const previous = installed.get(original) ?? original;
		if (path === previous) pending.delete(path);
		else pending.set(path, previous);
	}
}
