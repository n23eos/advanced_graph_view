/**
 * Grouping and depth rules that drive the 3D layout.
 *
 * GraphView is an Obsidian ItemView and drags the whole app with it, so these
 * two rules — "which notes belong together" and "how far back does each note
 * sit" — are kept out here where they can be exercised without a vault.
 */
import type { NodeFacts } from "../encoding/metrics";
import type { LayoutRule } from "../workers/layoutEngine";

/** Nodes that belong to no group. */
export const UNGROUPED = -1;

/**
 * Group id per node: notes sharing a primary tag (or a folder) get the same id.
 *
 * Untagged notes and notes at the vault root are left ungrouped rather than
 * lumped into one bucket — a giant "everything else" clump would out-mass every
 * real group and drag the layout into it.
 */
export function computeGroups(rule: LayoutRule, facts: readonly NodeFacts[]): Int32Array {
	const groups = new Int32Array(facts.length).fill(UNGROUPED);
	if (rule === "links") return groups; // links mode uses the edges, not groups

	const ids = new Map<string, number>();
	for (let i = 0; i < facts.length; i++) {
		const node = facts[i];
		if (!node) continue;
		const key = rule === "tags" ? (node.tags[0] ?? "") : node.folder;
		if (!key || key === "/") continue;

		let id = ids.get(key);
		if (id === undefined) {
			id = ids.size;
			ids.set(key, id);
		}
		groups[i] = id;
	}
	return groups;
}

/** How deep the depth axis reaches, in world units, front to back. */
export const DEPTH_SPREAD = 700;

/**
 * Depth per node when the z axis encodes something other than physics.
 *
 * Both modes map onto the same centered range so switching between them does
 * not change how far the cloud extends — only how notes are ordered within it.
 */
export function depthByCluster(community: Int32Array, communityCount: number): Float32Array {
	const layers = Math.max(communityCount, 1);
	const depths = new Float32Array(community.length);
	for (let i = 0; i < community.length; i++) {
		depths[i] = ((community[i] + 0.5) / layers - 0.5) * DEPTH_SPREAD;
	}
	return depths;
}

/** Oldest notes to the back, newest to the front. */
export function depthByAge(facts: readonly NodeFacts[]): Float32Array {
	const depths = new Float32Array(facts.length);
	if (facts.length === 0) return depths;

	let min = Infinity;
	let max = -Infinity;
	for (const node of facts) {
		if (node.ctime < min) min = node.ctime;
		if (node.ctime > max) max = node.ctime;
	}
	// A vault where every note shares a timestamp has no age axis; keeping the
	// range at 1 collapses it to a flat plane instead of dividing by zero.
	const range = Math.max(max - min, 1);
	for (let i = 0; i < facts.length; i++) {
		depths[i] = ((facts[i].ctime - min) / range - 0.5) * DEPTH_SPREAD;
	}
	return depths;
}
