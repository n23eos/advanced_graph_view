import { afterEach, describe, expect, test, vi } from "vitest";
import { Application, Container } from "pixi.js";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

describe("GraphRenderer startup", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	test("requests only WebGL instead of falling back to the Canvas renderer", async () => {
		const init = vi.spyOn(Application.prototype, "init").mockRejectedValue(new Error("WebGL unavailable"));
		const destroy = vi.spyOn(Container.prototype, "destroy");
		const renderer = new GraphRenderer({} as RendererCallbacks);

		await expect(renderer.init({} as HTMLElement)).rejects.toThrow("WebGL unavailable");

		expect(init).toHaveBeenCalledWith(expect.objectContaining({ preference: ["webgl"] }));
		expect(destroy).toHaveBeenCalledOnce();
	});

	test("reports context loss while active but ignores the loss triggered by teardown", () => {
		const onContextLost = vi.fn();
		const renderer = new GraphRenderer({ onContextLost } as unknown as RendererCallbacks);
		const canvas = new EventTarget();
		vi.stubGlobal("window", { removeEventListener: vi.fn() });
		const internal = renderer as unknown as {
			app: { canvas: EventTarget; destroy: ReturnType<typeof vi.fn> } | null;
			handleContextLost: (event: Event) => void;
		};
		const destroyApp = vi.fn(() => {
			canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
		});
		internal.app = { canvas, destroy: destroyApp };
		canvas.addEventListener("webglcontextlost", internal.handleContextLost);

		const activeLoss = new Event("webglcontextlost", { cancelable: true });
		canvas.dispatchEvent(activeLoss);

		expect(activeLoss.defaultPrevented).toBe(true);
		expect(onContextLost).toHaveBeenCalledOnce();

		onContextLost.mockClear();
		renderer.destroy();
		renderer.destroy();

		expect(destroyApp).toHaveBeenCalledOnce();
		expect(destroyApp).toHaveBeenCalledWith(
			{ removeView: true },
			{ children: true, texture: true }
		);
		expect(onContextLost).not.toHaveBeenCalled();
	});
});
