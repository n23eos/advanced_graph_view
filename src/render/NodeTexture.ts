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
	const g = new Graphics();
	const coreRadius = NODE_TEXTURE_RADIUS * (1 - GLOW_SPREAD);
	for (let i = GLOW_LAYERS; i >= 1; i--) {
		const t = i / GLOW_LAYERS;
		g.circle(NODE_TEXTURE_RADIUS, NODE_TEXTURE_RADIUS, coreRadius + (NODE_TEXTURE_RADIUS - coreRadius) * t);
		g.fill({ color: 0xffffff, alpha: 0.045 * (1 - t) + 0.02 });
	}
	g.circle(NODE_TEXTURE_RADIUS, NODE_TEXTURE_RADIUS, coreRadius);
	g.fill({ color: 0xffffff, alpha: 1 });

	const texture = renderer.generateTexture({ target: g, resolution: 2 });
	g.destroy();
	return texture;
}
