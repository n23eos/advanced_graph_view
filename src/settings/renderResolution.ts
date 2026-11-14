import type { RenderScale } from "./schema";

export interface RenderResolutionOptions {
	resolution: number;
	autoDensity: boolean;
}

export function renderResolution(
	scale: RenderScale,
	devicePixelRatio: number
): RenderResolutionOptions {
	if (scale === "high") {
		return { resolution: Math.min(devicePixelRatio, 2), autoDensity: true };
	}
	return { resolution: 1, autoDensity: false };
}
