/**
 * Three named layouts that stand in for five physics sliders. The simple panel
 * offers only these, so a casual user picks how tight the cloud looks instead
 * of tuning repulsion, link length and spring strength by hand.
 */
import type { PhysicsParams } from "../workers/layoutEngine";

export type LayoutDensity = "dense" | "normal" | "loose";

export const LAYOUT_DENSITIES: readonly LayoutDensity[] = ["dense", "normal", "loose"];

/** The parameters a density owns. Everything else in PhysicsParams is left
 *  alone, so switching density never resets an unrelated expert tweak. */
type DensityParams = Pick<PhysicsParams, "repel" | "linkDistance" | "linkStrength">;

/** "normal" matches DEFAULT_3D_PANEL, so an untouched vault already sits on a
 *  preset and shows it as the active one. */
export const LAYOUT_DENSITY_PRESETS: Record<LayoutDensity, DensityParams> = {
	dense: { repel: 45, linkDistance: 95, linkStrength: 0.3 },
	normal: { repel: 112, linkDistance: 205, linkStrength: 0.08 },
	loose: { repel: 230, linkDistance: 300, linkStrength: 0.04 },
};

export function applyLayoutDensity(physics: PhysicsParams, density: LayoutDensity): PhysicsParams {
	return { ...physics, ...LAYOUT_DENSITY_PRESETS[density] };
}

/** Which preset these physics came from, or null when the user hand-tuned them
 *  in the expert panel. Drives the pressed state of the density buttons. */
export function matchLayoutDensity(physics: PhysicsParams): LayoutDensity | null {
	return (
		LAYOUT_DENSITIES.find((density) => {
			const preset = LAYOUT_DENSITY_PRESETS[density];
			return (
				physics.repel === preset.repel &&
				physics.linkDistance === preset.linkDistance &&
				physics.linkStrength === preset.linkStrength
			);
		}) ?? null
	);
}
