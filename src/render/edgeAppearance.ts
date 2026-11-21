import { BufferImageSource, Texture } from "pixi.js";

const PROFILE = [0.16, 0.62, 0.92, 1, 1, 0.92, 0.62, 0.16];
const ATLAS_COLUMNS = 64;
const ATLAS_ROWS = 64;
const ATLAS_WIDTH = ATLAS_COLUMNS * PROFILE.length;

function mixColor(a: number, b: number, amount: number): number {
	const channel = (shift: number) => {
		const start = (a >> shift) & 255;
		return Math.round(start + (((b >> shift) & 255) - start) * amount);
	};
	return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Keep links in the node palette. Soften links between differently colored groups. */
export function edgeColor(source: number, target: number, accent: number, foreground: number): number {
	const a = source >= 0 ? source : accent;
	const b = target >= 0 ? target : accent;
	return mixColor(a === b ? a : mixColor(a, b, 0.5), foreground, a === b ? 0.16 : 0.26);
}

/** A small RGB atlas with a soft cross-section. One texture and one mesh for the whole graph. */
export function createEdgeTexture(): Texture {
	const pixels = new Uint8Array(ATLAS_WIDTH * ATLAS_ROWS * 4);
	for (let color = 0; color < 4096; color++) {
		const at = Math.floor(color / ATLAS_COLUMNS) * ATLAS_WIDTH + color % ATLAS_COLUMNS * PROFILE.length;
		const red = ((color >> 8) & 15) * 17;
		const green = ((color >> 4) & 15) * 17;
		const blue = (color & 15) * 17;
		for (let x = 0; x < PROFILE.length; x++) {
			const offset = (at + x) * 4;
			const alpha = PROFILE[x];
			pixels[offset] = Math.round(red * alpha);
			pixels[offset + 1] = Math.round(green * alpha);
			pixels[offset + 2] = Math.round(blue * alpha);
			pixels[offset + 3] = Math.round(255 * alpha);
		}
	}
	return new Texture({ source: new BufferImageSource({
		resource: pixels, width: ATLAS_WIDTH, height: ATLAS_ROWS,
		scaleMode: "linear", alphaMode: "premultiplied-alpha",
	}) });
}

export function writeEdgeUVs(uvs: Float32Array, offset: number, points: number, color: number): void {
	const slot = ((color >> 12) & 0xf00) | ((color >> 8) & 0xf0) | ((color >> 4) & 0xf);
	const x = slot % ATLAS_COLUMNS * PROFILE.length;
	const y = (Math.floor(slot / ATLAS_COLUMNS) + 0.5) / ATLAS_ROWS;
	const left = (x + 0.5) / ATLAS_WIDTH;
	const right = (x + PROFILE.length - 0.5) / ATLAS_WIDTH;
	for (let end = offset + points * 4; offset < end; offset += 4) {
		uvs[offset] = left;
		uvs[offset + 2] = right;
		uvs[offset + 1] = uvs[offset + 3] = y;
	}
}

/** Width is authored in graph units, with a screen-space floor and cap in 2D. */
export function edgeWorldWidth(width: number, zoom: number): number {
	const scale = Math.max(0.001, zoom);
	return width * Math.max(0.95, Math.min(1.8, scale)) / scale;
}
