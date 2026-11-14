import { GraphInsightView } from "./GraphView";

/** Deferred leaves contain placeholders until Obsidian loads their real view. */
export function findGraphView(leaves: readonly { view: unknown }[]): GraphInsightView | null {
	for (const leaf of leaves) {
		if (leaf.view instanceof GraphInsightView) return leaf.view;
	}
	return null;
}
