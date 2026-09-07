import { resolvePreset } from "../encoding/colorScales";

export type NodeStyle = "flat" | "glow" | "ring";
export const NODE_STYLES: readonly NodeStyle[] = ["flat", "glow", "ring"];

export function isNodeStyle(value: unknown): value is NodeStyle {
	return typeof value === "string" && (NODE_STYLES as readonly string[]).includes(value);
}

export function nodeStyleFromPreset(presetId: string): NodeStyle {
	return resolvePreset(presetId).glow === true ? "glow" : "flat";
}

export function effectiveNodeStyle(style: NodeStyle, lightTheme: boolean): NodeStyle {
	return style === "glow" && lightTheme ? "flat" : style;
}
