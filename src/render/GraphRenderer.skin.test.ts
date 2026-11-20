import { describe, expect, test, vi } from "vitest";
import { Sprite, Texture } from "pixi.js";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

interface SkinHarness {
	app: { renderer: { background: { alpha: number; color: number } } };
	nodeTextureCache: { get: ReturnType<typeof vi.fn> };
	sprites: Sprite[];
	nodeStyle: string;
	colorScheme: string;
}

describe("GraphRenderer material switching", () => {
	test("switches scheme texture live without replacing style or tint", () => {
		const renderer = new GraphRenderer({} as RendererCallbacks);
		const state = renderer as unknown as SkinHarness;
		const textures = new Map<string, Texture>();
		const get = vi.fn((scheme: string, style: string) => {
			const key = `${scheme}:${style}`;
			let texture = textures.get(key);
			if (!texture) {
				texture = new Texture({ label: key });
				textures.set(key, texture);
			}
			return texture;
		});
		const sprite = new Sprite(Texture.EMPTY);
		sprite.tint = 0x12abef;
		state.app = { renderer: { background: { alpha: 0, color: 0 } } };
		state.nodeTextureCache = { get };
		state.sprites = [sprite];

		renderer.setVisualStyle("glow", 0x05050f, "galaxy");
		const galaxyTexture = sprite.texture;
		renderer.setVisualStyle("glow", 0x060a14, "neon");

		expect(sprite.texture).not.toBe(galaxyTexture);
		expect(state.nodeStyle).toBe("glow");
		expect(state.colorScheme).toBe("neon");
		expect(sprite.tint).toBe(0x12abef);
		expect(sprite.blendMode).toBe("add");

		renderer.setVisualStyle("ring", null, "neon");
		const neonRing = sprite.texture;
		renderer.setVisualStyle("ring", null, "galaxy");

		expect(sprite.texture).not.toBe(neonRing);
		expect(state.nodeStyle).toBe("ring");
		expect(sprite.tint).toBe(0x12abef);
		expect(sprite.blendMode).toBe("normal");
	});
});
