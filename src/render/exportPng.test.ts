import { afterEach, describe, expect, test, vi } from "vitest";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

interface ExportHarness {
	app: {
		stage: object;
		screen: { x: number; y: number; width: number; height: number };
		renderer: {
			extract: {
				canvas: ReturnType<typeof vi.fn>;
			};
		};
	} | null;
}

describe("GraphRenderer PNG export", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("extracts the visible viewport instead of the full stage bounds", async () => {
		const renderer = new GraphRenderer({} as RendererCallbacks);
		const harness = renderer as unknown as ExportHarness;
		const stage = {
			bounds: { x: -19_123, y: -114_920, width: 47_994, height: 133_474 },
		};
		const screen = { x: 0, y: 0, width: 988, height: 1174 };
		const blob = new Blob(["png"], { type: "image/png" });
		const canvas = {
			width: screen.width * 2,
			height: screen.height * 2,
			toBlob: (callback: BlobCallback) => callback(blob),
		} as HTMLCanvasElement;
		const extractCanvas = vi.fn((options: { frame?: typeof screen }) => {
			if (!options.frame) throw new RangeError("Invalid typed array length 101221965600");
			return canvas;
		});
		harness.app = {
			stage,
			screen,
			renderer: { extract: { canvas: extractCanvas } },
		};

		await expect(renderer.exportPng()).resolves.toBe(blob);
		expect(extractCanvas).toHaveBeenCalledWith({
			target: stage,
			frame: screen,
			resolution: 2,
		});
	});

	test("returns null when viewport extraction fails", async () => {
		const renderer = new GraphRenderer({} as RendererCallbacks);
		const harness = renderer as unknown as ExportHarness;
		const error = new RangeError("Invalid typed array length 101221965600");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		harness.app = {
			stage: {},
			screen: { x: 0, y: 0, width: 988, height: 1174 },
			renderer: { extract: { canvas: vi.fn(() => { throw error; }) } },
		};

		await expect(renderer.exportPng()).resolves.toBeNull();
		expect(consoleError).toHaveBeenCalledWith("Advanced Graph View: PNG export failed", error);
	});
});
