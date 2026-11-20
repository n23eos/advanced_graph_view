import { describe, expect, test, vi } from "vitest";
import type { Renderer, Texture } from "pixi.js";
import { NodeTextureCache } from "./NodeTexture";

function harness() {
	const textures: Texture[] = [];
	const destroyCalls: unknown[][][] = [];
	const generateTexture = vi.fn(() => {
		const calls: unknown[][] = [];
		const textureState = { destroyed: false };
		const destroy = (...args: unknown[]) => {
			calls.push(args);
			textureState.destroyed = true;
		};
		const texture = {
			get destroyed() { return textureState.destroyed; },
			destroy,
		} as unknown as Texture;
		textures.push(texture);
		destroyCalls.push(calls);
		return texture;
	});
	const cache = new NodeTextureCache({ generateTexture } as unknown as Renderer);
	return { cache, destroyCalls, generateTexture, textures };
}

describe("NodeTextureCache", () => {
	test("reuses a texture for the same scheme and style", () => {
		const { cache, generateTexture } = harness();
		const first = cache.get("neon", "glow", 1);
		const second = cache.get("neon", "glow", 1);

		expect(second).toBe(first);
		expect(generateTexture).toHaveBeenCalledOnce();
	});

	test("keeps distinct cached materials while schemes switch", () => {
		const { cache, generateTexture } = harness();
		const galaxy = cache.get("galaxy", "glow", 1);
		const nebula = cache.get("nebula", "glow", 1);
		const neon = cache.get("neon", "glow", 1);

		expect(new Set([galaxy, nebula, neon]).size).toBe(3);
		expect(cache.get("galaxy", "glow", 1)).toBe(galaxy);
		expect(generateTexture).toHaveBeenCalledTimes(3);
	});

	test("invalidates only the requested node style", () => {
		const { cache, destroyCalls, generateTexture } = harness();
		const flat = cache.get("neon", "flat", 1);
		const glow = cache.get("neon", "glow", 1);

		cache.invalidate("glow");

		expect(cache.get("neon", "flat", 1)).toBe(flat);
		expect(cache.get("neon", "glow", 1)).not.toBe(glow);
		expect(destroyCalls[1]).toEqual([[true]]);
		expect(generateTexture).toHaveBeenCalledTimes(3);
	});
});
