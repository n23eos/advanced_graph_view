import { afterEach, describe, expect, test, vi } from "vitest";
import { Application } from "pixi.js";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

afterEach(() => vi.restoreAllMocks());

describe("renderer resolution initialization", () => {
	test.each([
		["standard", 3, 1, false],
		["high", 3, 2, true],
		["high", 1.5, 1.5, true],
	] as const)("%s uses host pixel ratio %s as resolution %s", async (scale, ratio, resolution, autoDensity) => {
		const init = vi.spyOn(Application.prototype, "init").mockRejectedValue(new Error("stop after options"));
		const host = { ownerDocument: { defaultView: { devicePixelRatio: ratio } } } as unknown as HTMLElement;
		const renderer = new GraphRenderer({} as RendererCallbacks);
		await expect(renderer.init(host, scale)).rejects.toThrow("stop after options");
		expect(init).toHaveBeenCalledWith(expect.objectContaining({ resolution, autoDensity }));
	});
});
