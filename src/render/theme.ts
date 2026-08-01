/**
 * Which way round the Obsidian theme is. Obsidian marks the body with
 * `theme-dark` or `theme-light`; anything else (a theme that sets neither) is
 * treated as dark, which is what the schemes were tuned for.
 */
import { resolvePreset, type ScalePreset } from "../encoding/colorScales";
import { adaptPresetToTheme } from "../encoding/themeContrast";

export function isLightTheme(): boolean {
	return document.body.classList.contains("theme-light");
}

/** The scheme as it is actually drawn right now, theme adaptation included.
 *  Everything that paints scheme colors — nodes, legend, cluster bubbles —
 *  must go through this, or they drift apart on a light theme. */
export function activePreset(presetId: string): ScalePreset {
	return adaptPresetToTheme(resolvePreset(presetId), isLightTheme());
}
