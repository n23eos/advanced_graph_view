/** Optional graph membership. Missing scope always means the legacy graph. */
export interface GraphScope { attachments: boolean; unresolved: boolean }
export function normalizeGraphScope(raw: unknown): GraphScope {
	const value = typeof raw === "object" && raw !== null ? raw as Partial<GraphScope> : {};
	return { attachments: value.attachments === true, unresolved: value.unresolved === true };
}
export function sameGraphScope(a?: GraphScope, b?: GraphScope): boolean {
	return (a?.attachments ?? false) === (b?.attachments ?? false)
		&& (a?.unresolved ?? false) === (b?.unresolved ?? false);
}
export function isGraphScope(raw: unknown): raw is GraphScope {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
	const value = raw as Partial<GraphScope>;
	return typeof value.attachments === "boolean" && typeof value.unresolved === "boolean";
}
