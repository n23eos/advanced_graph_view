// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { Sprite, Texture } from "pixi.js";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { installObsidianDom } from "../test/obsidianDom";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

interface HiddenExportHarness {
	app: {
		canvas: HTMLCanvasElement;
		render: ReturnType<typeof vi.fn>;
		screen: { x: number; y: number; width: number; height: number };
		stage: object;
		ticker: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
		renderer: {
			extract: { canvas: ReturnType<typeof vi.fn> };
		};
	} | null;
	model: GraphModel | null;
	positions: Float32Array | null;
	positions3: Float32Array | null;
	radii: Float32Array | null;
	sprites: Sprite[];
	colors: { node: number; nodeSelected: number; edge: number; label: number } | null;
	viewport: {
		scale: number;
		referenceScale: number;
		toWorld(x: number, y: number): { x: number; y: number };
	} | null;
	labelsVisible: boolean;
	labelPriority: number[];
	cullDirty: boolean;
	renderFrame(force?: boolean): void;
}

beforeAll(() => installObsidianDom());

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("GraphRenderer hidden PNG export", () => {
	test("reculls against the retained Pixi screen after a hidden frame cleared the dirty flag", async () => {
		const renderer = new GraphRenderer({} as RendererCallbacks);
		const state = renderer as unknown as HiddenExportHarness;
		const canvas = document.body.createEl("canvas");
		Object.defineProperties(canvas, {
			clientWidth: { value: 0 },
			clientHeight: { value: 0 },
		});
		const sprite = new Sprite(Texture.EMPTY);
		const blob = new Blob(["png"], { type: "image/png" });
		const extract = vi.fn(() => ({
			toBlob: (callback: BlobCallback) => callback(blob),
		}));
		const render = vi.fn();
		state.app = {
			canvas,
			render,
			screen: { x: 0, y: 0, width: 800, height: 600 },
			stage: {},
			ticker: { start: vi.fn(), stop: vi.fn() },
			renderer: { extract: { canvas: extract } },
		};
		state.model = buildGraphModel(["note.md"], {}, {});
		state.positions = new Float32Array([400, 300]);
		state.positions3 = new Float32Array([400, 300, 0]);
		state.radii = new Float32Array([5]);
		state.sprites = [sprite];
		state.colors = { node: 0xffffff, nodeSelected: 0xff0000, edge: 0x999999, label: 0xffffff };
		state.viewport = {
			scale: 1,
			referenceScale: 1,
			toWorld: (x, y) => ({ x, y }),
		};
		state.labelsVisible = false;
		state.labelPriority = [0];
		state.cullDirty = true;
		renderer.camera.enabled = false;
		state.renderFrame();
		expect(sprite.visible).toBe(false);
		expect(state.cullDirty).toBe(false);
		render.mockClear();
		renderer.pause();

		await expect(renderer.exportPng()).resolves.toBe(blob);

		expect(sprite.visible).toBe(true);
		expect(render).toHaveBeenCalledOnce();
		expect(extract).toHaveBeenCalledOnce();
	});
});
