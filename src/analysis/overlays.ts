/**
 * Overlay layers: orphans (no inbound links), dead ends (no outbound),
 * broken (has unresolved links). Pure selectors over the graph model.
 */
import type { GraphModel } from "../data/GraphStore";

export interface OverlayToggles {
	orphans: boolean;
	deadEnds: boolean;
	broken: boolean;
}

export interface OverlayCounts {
	orphans: number;
	deadEnds: number;
	broken: number;
}

/** 1 = node matches an active overlay; null when no overlay is active. */
export function computeOverlayMask(model: GraphModel, toggles: OverlayToggles): Uint8Array | null {
	if (!toggles.orphans && !toggles.deadEnds && !toggles.broken) return null;
	const mask = new Uint8Array(model.nodes.length);
	for (const node of model.nodes) {
		const isMatch =
			(toggles.orphans && node.inCount === 0) ||
			(toggles.deadEnds && node.outCount === 0) ||
			(toggles.broken && node.unresolvedCount > 0);
		if (isMatch) mask[node.id] = 1;
	}
	return mask;
}

export function countOverlayMatches(model: GraphModel): OverlayCounts {
	let orphans = 0;
	let deadEnds = 0;
	let broken = 0;
	for (const node of model.nodes) {
		if (node.inCount === 0) orphans++;
		if (node.outCount === 0) deadEnds++;
		if (node.unresolvedCount > 0) broken++;
	}
	return { orphans, deadEnds, broken };
}
