/**
 * F-07: "Restore recommended values" for the physics section. The baseline is
 * the applied builtin preset; without one, the bundled Default 3D / Default 2D
 * panel for the current dimensionality.
 */
import type { PhysicsParams } from "../workers/layoutEngine";
import { DEFAULT_VIEW_PRESETS, type ViewPreset } from "../view/builtinPresets";

export function recommendedPhysics(activePreset: ViewPreset | null, is3d: boolean): PhysicsParams {
	if (activePreset?.builtinId) return activePreset.panel.physics;
	const id = is3d ? "default-3d" : "default-2d";
	const fallback = DEFAULT_VIEW_PRESETS.find((preset) => preset.builtinId === id);
	return (fallback ?? DEFAULT_VIEW_PRESETS[0]).panel.physics;
}

export interface PhysicsChange {
	key: string;
	from: number | boolean | undefined;
	to: number | boolean | undefined;
}

/** Which parameters the reset would change, for the pre-reset summary. */
export function physicsDiff(current: PhysicsParams, next: PhysicsParams): PhysicsChange[] {
	const keys = new Set([...Object.keys(current), ...Object.keys(next)] as (keyof PhysicsParams)[]);
	const changes: PhysicsChange[] = [];
	for (const key of keys) {
		const from = current[key];
		const to = next[key];
		if (from !== to) changes.push({ key, from, to });
	}
	return changes;
}

/** "repel 30→112, linkDistance 25→205" — expert-panel parameter names. */
export function formatPhysicsDiff(changes: PhysicsChange[]): string {
	return changes.map(({ key, from, to }) => `${key} ${String(from)}→${String(to)}`).join(", ");
}
