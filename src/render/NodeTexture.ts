import { Graphics, type Renderer, type Texture } from "pixi.js";
import type { NodeStyle } from "./nodeStyle";
import { nodeSkinForScheme, type NodeSkin } from "./nodeSkin";

/**
 * One shared circle-with-glow texture; every node is a tinted sprite of it,
 * which keeps 10k nodes in a single Pixi batch.
 */
export const NODE_TEXTURE_RADIUS = 32;
const GLOW_LAYERS = 6;
// Glow takes the outer 30% of the texture: on dense graphs the sprite quad
// area is the GPU fill-rate cost, so the core must dominate the quad.
const GLOW_SPREAD = 0.3;

export function createNodeTexture(renderer: Renderer): Texture {
	return buildTexture(renderer, "classic", GLOW_SPREAD, GLOW_LAYERS, 0.045, 0.02);
}

/**
 * Star variant for the glow schemes: a small bright core inside a wide, soft
 * halo. Drawn with additive blending it makes dense regions bloom.
 */
const STAR_GLOW_SPREAD = 0.6;
const STAR_GLOW_LAYERS = 10;
/** Star cores are smaller inside the quad — sprites grow to compensate. */
export const STAR_SIZE_FACTOR = 1.8;
const RING_RADIUS = 0.82;
const RING_STROKE = 0.18;

/** Clickable bright core as a fraction of the sprite radius. */
export function nodeCoreRatio(style: NodeStyle): number {
	if (style === "ring") return RING_RADIUS + RING_STROKE / 2;
	return 1 - (style === "glow" ? STAR_GLOW_SPREAD : GLOW_SPREAD);
}

export function createStarTexture(renderer: Renderer, intensity = 1): Texture {
	return buildTexture(renderer, "star", STAR_GLOW_SPREAD, STAR_GLOW_LAYERS,
		0.09 * intensity, 0.012 * intensity, intensity);
}

/** Hollow style that remains distinct on both light and dark themes. */
export function createRingTexture(renderer: Renderer): Texture {
	return buildRingTexture(renderer, "classic");
}

/** One generated Pixi texture per scheme/style pair, scoped to its renderer. */
export class NodeTextureCache {
	private readonly textures = new Map<string, Texture>();

	constructor(private readonly renderer: Renderer) {}

	get(schemeId: string, style: NodeStyle, glowIntensity = 1): Texture {
		const intensity = style === "glow" ? Math.max(0, glowIntensity) : 1;
		const key = `${schemeId}:${style}:${intensity.toFixed(3)}`;
		const cached = this.textures.get(key);
		if (cached && !cached.destroyed) return cached;

		const skin = nodeSkinForScheme(schemeId);
		const texture = style === "ring"
			? buildRingTexture(this.renderer, skin)
			: style === "glow"
				? buildTexture(this.renderer, skin, STAR_GLOW_SPREAD, STAR_GLOW_LAYERS,
					0.09 * intensity, 0.012 * intensity, intensity)
				: buildTexture(this.renderer, skin, GLOW_SPREAD, GLOW_LAYERS, 0.045, 0.02);
		this.textures.set(key, texture);
		return texture;
	}

	invalidate(style: NodeStyle): void {
		for (const [key, texture] of this.textures) {
			if (!key.includes(`:${style}:`)) continue;
			if (!texture.destroyed) texture.destroy(true);
			this.textures.delete(key);
		}
	}

	destroy(): void {
		for (const texture of this.textures.values()) {
			if (!texture.destroyed) texture.destroy(true);
		}
		this.textures.clear();
	}
}

function buildRingTexture(renderer: Renderer, skin: NodeSkin): Texture {
	const g = new Graphics();
	const radius = NODE_TEXTURE_RADIUS * RING_RADIUS;
	drawSkin(g, skin, radius);
	g.fill({ color: 0xffffff, alpha: 0.12 });
	g.stroke({ color: 0xffffff, alpha: 1, width: NODE_TEXTURE_RADIUS * RING_STROKE });
	drawMaterialDetails(g, skin, radius, true);
	const texture = renderer.generateTexture({ target: g, resolution: 2 });
	g.destroy();
	return texture;
}

function buildTexture(
	renderer: Renderer,
	skin: NodeSkin,
	spread: number,
	layers: number,
	falloff: number,
	floor: number,
	detailIntensity = 1
): Texture {
	const g = new Graphics();
	const coreRadius = NODE_TEXTURE_RADIUS * (1 - spread);
	for (let i = layers; i >= 1; i--) {
		const t = i / layers;
		drawSkin(g, skin, coreRadius + (NODE_TEXTURE_RADIUS - coreRadius) * t);
		g.fill({ color: 0xffffff, alpha: falloff * (1 - t) + floor });
	}
	drawSkin(g, skin, coreRadius);
	g.fill({ color: 0xffffff, alpha: skin === "neon" ? 0.1 : 1 });
	drawMaterialDetails(g, skin, coreRadius, false, detailIntensity);

	const texture = renderer.generateTexture({ target: g, resolution: 2 });
	g.destroy();
	return texture;
}

function drawSkin(g: Graphics, skin: NodeSkin, radius: number): void {
	const c = NODE_TEXTURE_RADIUS;
	if (skin === "star" || skin === "nebula") {
		g.circle(c, c, radius);
		return;
	}
	if (skin === "neon") {
		g.poly([c, c - radius, c + radius, c, c, c + radius, c - radius, c], true);
		return;
	}
	if (skin === "ember") {
		g.star(c, c, 8, radius, radius * 0.66, -Math.PI / 2);
		return;
	}
	if (skin === "facet") {
		g.star(c, c, 6, radius, radius, -Math.PI / 2);
		return;
	}
	if (skin === "sun") {
		g.star(c, c, 12, radius, radius * 0.73, -Math.PI / 2);
		return;
	}
	if (skin === "petal") {
		g.star(c, c, 6, radius, radius * 0.58, -Math.PI / 2);
		return;
	}
	g.circle(c, c, radius);
}

function drawMaterialDetails(
	g: Graphics, skin: NodeSkin, radius: number, ring: boolean, detailIntensity = 1
): void {
	const c = NODE_TEXTURE_RADIUS;
	const width = Math.max(1, radius * (ring ? 0.05 : 0.075));
	if (skin === "star") {
		g.circle(c, c, radius * 0.42);
		g.fill({ color: 0xffffff, alpha: ring ? 0.5 : 1 });
	} else if (skin === "nebula") {
		g.ellipse(c - radius * 0.14, c + radius * 0.08, radius * 1.22, radius * 0.7);
		g.fill({ color: 0xffffff, alpha: (ring ? 0.08 : 0.1) * detailIntensity });
		g.ellipse(c + radius * 0.2, c - radius * 0.13, radius * 0.92, radius * 0.56);
		g.fill({ color: 0xffffff, alpha: (ring ? 0.11 : 0.14) * detailIntensity });
		g.ellipse(c - radius * 0.25, c - radius * 0.18, radius * 0.7, radius * 0.42);
		g.fill({ color: 0xffffff, alpha: (ring ? 0.13 : 0.18) * detailIntensity });
		g.circle(c, c, radius * 0.58);
		g.fill({ color: 0xffffff, alpha: ring ? 0.18 : 1 });
	} else if (skin === "neon") {
		g.poly([c, c - radius, c + radius, c, c, c + radius, c - radius, c], true);
		g.stroke({ color: 0xffffff, alpha: 1, width: Math.max(1.2, width * 1.35) });
		const inset = radius * 0.57;
		g.poly([c, c - inset, c + inset, c, c, c + inset, c - inset, c], true);
		g.stroke({ color: 0xffffff, alpha: ring ? 0.82 : 0.74, width });
	} else if (skin === "facet") {
		g.moveTo(c, c - radius * 0.86);
		g.lineTo(c, c + radius * 0.86);
		g.moveTo(c - radius * 0.74, c - radius * 0.43);
		g.lineTo(c + radius * 0.74, c + radius * 0.43);
		g.moveTo(c + radius * 0.74, c - radius * 0.43);
		g.lineTo(c - radius * 0.74, c + radius * 0.43);
		g.stroke({ color: 0xffffff, alpha: ring ? 0.55 : 0.28, width });
	}
}
