/**
 * Companion pane: the split beside the graph that notes open into, so the graph
 * stays on screen instead of being covered by whatever you clicked.
 *
 * The decision of whether to reuse the remembered pane is kept here, free of
 * the Obsidian workspace, because it is the part that has edge cases: the user
 * can close the pane, and the graph's own pane must never be borrowed.
 */

export type CompanionAction = "reuse" | "create";

export function chooseCompanionAction<T>(
	remembered: T | null,
	openLeaves: readonly T[],
	graphLeaf: T
): CompanionAction {
	if (remembered === null) return "create";
	// Opening into the graph's own pane would replace the graph with the note,
	// which is exactly what this mode exists to prevent.
	if (remembered === graphLeaf) return "create";
	return openLeaves.includes(remembered) ? "reuse" : "create";
}
