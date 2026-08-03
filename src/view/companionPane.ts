/**
 * Companion pane: the split beside the graph that notes open into, so the graph
 * stays on screen instead of being covered by whatever you clicked.
 *
 * The decision of whether to reuse the remembered pane is kept here, free of
 * the Obsidian workspace, because it is the part that has edge cases: the user
 * can close the pane, and the graph's own pane must never be borrowed.
 *
 * Panes are identified by leaf id, never by object identity — Obsidian can
 * rebuild the WorkspaceLeaf behind the same id, and comparing objects made
 * every rebuilt pane look closed, so each click opened one more split.
 */

export type CompanionAction = "reuse" | "create";

export function chooseCompanionAction(
	rememberedId: string | null,
	openLeafIds: readonly string[],
	graphLeafId: string
): CompanionAction {
	if (rememberedId === null) return "create";
	// Opening into the graph's own pane would replace the graph with the note,
	// which is exactly what this mode exists to prevent.
	if (rememberedId === graphLeafId) return "create";
	return openLeafIds.includes(rememberedId) ? "reuse" : "create";
}
