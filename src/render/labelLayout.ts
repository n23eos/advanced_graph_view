import { LabelCollisionGrid, type LabelBox } from "./labelCollision";

export type LabelRole =
	| "pointer"
	| "selected"
	| "action"
	| "search"
	| "neighbor"
	| "hub"
	| "group"
	| "normal";

export type LabelId = number | string;

export interface LabelLayoutCandidate {
	id: LabelId;
	/** Stable path or group key used as the deterministic final tie-breaker. */
	stableKey: string;
	role: LabelRole;
	importance: number;
	/** Current 2D zoom ratio or per-node 3D depth scale. */
	zoom: number;
	minZoom: number;
	wasVisible: boolean;
	eligible?: boolean;
	/** Ordered screen-space alternatives around the same anchor. */
	placements: readonly LabelBox[];
	preferredPlacement?: number;
}

export interface LabelSelectionOptions {
	hysteresis: number;
	/** Search labels are explicit only for result sets of eight or fewer. */
	searchResultCount?: number;
}

export interface LabelPlacementOptions {
	budget: number;
	reservations?: readonly LabelBox[];
	maxPlacements?: number;
}

export interface LabelPlacement {
	id: LabelId;
	role: LabelRole;
	box: LabelBox;
	placementIndex: number;
}

const ROLE_PRIORITY: Record<LabelRole, number> = {
	pointer: 0,
	selected: 1,
	action: 2,
	search: 3,
	neighbor: 4,
	hub: 5,
	group: 6,
	normal: 7,
};

function effectiveRole(candidate: LabelLayoutCandidate, searchResultCount?: number): LabelRole {
	if (candidate.role === "search" && searchResultCount !== undefined && searchResultCount > 8) {
		return "normal";
	}
	return candidate.role;
}

/**
 * A new label enters at minZoom. Once visible, it remains until zoom falls
 * below minZoom minus hysteresis, avoiding threshold flicker.
 */
export function passesLabelZoom(candidate: LabelLayoutCandidate, hysteresis: number): boolean {
	const safeHysteresis = Number.isFinite(hysteresis) ? Math.max(0, hysteresis) : 0;
	const threshold = candidate.wasVisible
		? candidate.minZoom - safeHysteresis
		: candidate.minZoom;
	return candidate.zoom >= threshold;
}

/** Pure filtering and deterministic priority order. Input is never mutated. */
export function selectLabelCandidates(
	candidates: readonly LabelLayoutCandidate[],
	options: LabelSelectionOptions
): LabelLayoutCandidate[] {
	return candidates
		.filter((candidate) => {
			if (candidate.eligible === false) return false;
			const role = effectiveRole(candidate, options.searchResultCount);
			const contextAlwaysVisible =
				role === "pointer" || role === "selected" || role === "action" || role === "search";
			return contextAlwaysVisible || passesLabelZoom(candidate, options.hysteresis);
		})
		.map((candidate, inputIndex) => ({ candidate, inputIndex }))
		.sort((left, right) => {
			const roleDifference =
				ROLE_PRIORITY[effectiveRole(left.candidate, options.searchResultCount)] -
				ROLE_PRIORITY[effectiveRole(right.candidate, options.searchResultCount)];
			if (roleDifference !== 0) return roleDifference;
			const leftImportance = Number.isFinite(left.candidate.importance) ? left.candidate.importance : 0;
			const rightImportance = Number.isFinite(right.candidate.importance) ? right.candidate.importance : 0;
			if (leftImportance !== rightImportance) return rightImportance - leftImportance;
			if (left.candidate.stableKey < right.candidate.stableKey) return -1;
			if (left.candidate.stableKey > right.candidate.stableKey) return 1;
			return left.inputIndex - right.inputIndex;
		})
		.map(({ candidate }) => candidate);
}

/**
 * Place ranked candidates into a reusable grid. Reservations are inserted
 * first so fading text keeps its screen area until it is no longer readable.
 */
export function placeLabelCandidates(
	candidates: readonly LabelLayoutCandidate[],
	grid: LabelCollisionGrid,
	options: LabelPlacementOptions
): LabelPlacement[] {
	grid.clear();
	for (const box of options.reservations ?? []) grid.insert(box);
	const budget = Number.isFinite(options.budget) ? Math.max(0, Math.floor(options.budget)) : 0;
	const maxPlacements = Number.isFinite(options.maxPlacements)
		? Math.max(0, Math.floor(options.maxPlacements!))
		: 4;
	const placed: LabelPlacement[] = [];
	for (const candidate of candidates) {
		if (placed.length >= budget) break;
		const limit = Math.min(candidate.placements.length, maxPlacements);
		const preferred = candidate.preferredPlacement;
		if (preferred !== undefined && preferred >= 0 && preferred < limit) {
			const preferredBox = candidate.placements[preferred];
			if (grid.tryInsert(preferredBox)) {
				placed.push({ id: candidate.id, role: candidate.role, box: preferredBox, placementIndex: preferred });
				continue;
			}
		}
		for (let placementIndex = 0; placementIndex < limit; placementIndex++) {
			if (placementIndex === preferred) continue;
			const box = candidate.placements[placementIndex];
			if (!grid.tryInsert(box)) continue;
			placed.push({ id: candidate.id, role: candidate.role, box, placementIndex });
			break;
		}
	}
	return placed;
}
