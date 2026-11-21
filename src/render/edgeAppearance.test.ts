import { describe, expect, test } from "vitest";
import type { BufferImageSource } from "pixi.js";

import { createEdgeTexture, edgeColor, edgeWorldWidth, writeEdgeUVs } from "./edgeAppearance";

describe("edge appearance", () => {
	test("uses colors from both endpoints and respects the fallback accent", () => {
		expect(edgeColor(0xff0000, 0x0000ff, 0x00ff00, 0x000000)).toBe(0x5f005f);
		expect(edgeColor(-1, -1, 0x00ff00, 0x000000)).toBe(0x00d600);
	});

	test("samples a single rounded strand profile for every part of a curve", () => {
		const texture = createEdgeTexture();
		try {
			const uvs = new Float32Array(16);
			writeEdgeUVs(uvs, 0, 4, 0x22aa55);
			const sample = (u: number, v: number) => {
				const { width, height, resource } = texture.source as BufferImageSource;
				const at = (Math.floor(v * height) * width + Math.floor(u * width)) * 4;
				return Array.from((resource as Uint8Array).slice(at, at + 4));
			};
			expect(sample((uvs[0] + uvs[2]) / 2, uvs[1])).toEqual([34, 170, 85, 255]);
			expect(sample(uvs[0], uvs[1])[3]).toBeLessThan(255);
			expect(Array.from(uvs.slice(0, 8))).toEqual(Array.from(uvs.slice(8, 16)));
		} finally {
			texture.destroy(true);
		}
	});

	test("bounds displayed 2D width at both extremes of zoom", () => {
		expect(edgeWorldWidth(1, 0.25) * 0.25).toBeCloseTo(0.95);
		expect(edgeWorldWidth(1, 1.5) * 1.5).toBeCloseTo(1.5);
		expect(edgeWorldWidth(1, 5) * 5).toBeCloseTo(1.8);
	});
});
