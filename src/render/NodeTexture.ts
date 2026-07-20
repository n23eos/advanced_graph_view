import { Graphics, type Renderer, type Texture } from "pixi.js";

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
	return buildTexture(renderer, GLOW_SPREAD, GLOW_LAYERS, 0.045, 0.02);
}

/**
 * Star variant for the glow schemes: a small bright core inside a wide, soft
 * halo. Drawn with additive blending it makes dense regions bloom.
 */
const STAR_GLOW_SPREAD = 0.6;
const STAR_GLOW_LAYERS = 10;
/** Star cores are smaller inside the quad — sprites grow to compensate. */
export const STAR_SIZE_FACTOR = 1.8;

export function createStarTexture(renderer: Renderer): Texture {
	return buildTexture(renderer, STAR_GLOW_SPREAD, STAR_GLOW_LAYERS, 0.09, 0.012);
}

function buildTexture(
	renderer: Renderer,
	spread: number,
	layers: number,
	falloff: number,
	floor: number
): Texture {
	const g = new Graphics();
	const coreRadius = NODE_TEXTURE_RADIUS * (1 - spread);
	for (let i = layers; i >= 1; i--) {
		const t = i / layers;
		g.circle(NODE_TEXTURE_RADIUS, NODE_TEXTURE_RADIUS, coreRadius + (NODE_TEXTURE_RADIUS - coreRadius) * t);
		g.fill({ color: 0xffffff, alpha: falloff * (1 - t) + floor });
	}
	g.circle(NODE_TEXTURE_RADIUS, NODE_TEXTURE_RADIUS, coreRadius);
	g.fill({ color: 0xffffff, alpha: 1 });

	const texture = renderer.generateTexture({ target: g, resolution: 2 });
	g.destroy();
	return texture;
}
