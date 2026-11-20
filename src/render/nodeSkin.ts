export type NodeSkin = "classic" | "ember" | "facet" | "star" | "nebula" | "neon" | "sun" | "petal";

/**
 * Color schemes own a material silhouette, while nodeStyle still owns the
 * rendering treatment (solid, glow, or ring). This keeps a manual nodeStyle
 * choice intact when the palette changes.
 */
const SCHEME_SKINS: Readonly<Record<string, NodeSkin>> = {
	recency: "classic",
	heat: "ember",
	mono: "facet",
	galaxy: "star",
	nebula: "nebula",
	neon: "neon",
	solar: "sun",
	pastel: "petal",
};

export function nodeSkinForScheme(schemeId: string): NodeSkin {
	return SCHEME_SKINS[schemeId] ?? "classic";
}
