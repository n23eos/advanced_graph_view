// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { Application, Texture, Ticker, UPDATE_PRIORITY } from "pixi.js";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";
import { installObsidianDom } from "../test/obsidianDom";

beforeAll(() => installObsidianDom());
afterEach(() => { vi.restoreAllMocks(); document.body.empty(); });

async function setup() {
	const iframe = document.body.createEl("iframe");
	const ownerWindow = iframe.contentWindow!;
	installObsidianDom(ownerWindow);
	const host = document.body.createDiv();
	ownerWindow.document.body.appendChild(host);
	let width = 640;
	Object.defineProperties(host, {
		clientWidth: { get: () => width },
		clientHeight: { value: 480 },
	});
	let now = 1000;
	let nextFrame = 0;
	const frames = new Map<number, FrameRequestCallback>();
	const request = vi.spyOn(ownerWindow, "requestAnimationFrame").mockImplementation((callback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	});
	const cancel = vi.spyOn(ownerWindow, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
	vi.spyOn(ownerWindow.performance, "now").mockImplementation(() => now);
	const styles = vi.spyOn(ownerWindow, "getComputedStyle");
	const draw = vi.fn();
	const resize = vi.fn((nextWidth: number, nextHeight: number) => {
		screen.width = nextWidth;
		screen.height = nextHeight;
	});
	const screen = { x: 0, y: 0, width: 640, height: 480 };
	const ticker = new Ticker();
	const startTicker = vi.spyOn(ticker, "start");
	let canvas!: HTMLCanvasElement;
	const init = vi.spyOn(Application.prototype, "init").mockImplementation(async function (this: Application, options) {
		canvas = options?.canvas as HTMLCanvasElement ?? host.createEl("canvas");
		Object.assign(this, {
			ticker,
			renderer: { canvas, screen, render: draw, resize, generateTexture: () => Texture.EMPTY },
		});
		// eslint-disable-next-line @typescript-eslint/unbound-method -- Reproduce Pixi's explicit callback/context registration.
		ticker.add(this.render, this, UPDATE_PRIORITY.LOW);
	});
	vi.spyOn(Application.prototype, "destroy").mockImplementation(function (this: Application) {
		this.stage.destroy();
		this.canvas.remove();
		ticker.destroy();
	});
	const onNodeHover = vi.fn();
	const renderer = new GraphRenderer({ onNodeHover, onContextLost: vi.fn() } as unknown as RendererCallbacks);
	await renderer.init(host);
	const frame = (timestamp: number) => {
		now = timestamp;
		const queued = [...frames.values()];
		frames.clear();
		for (const callback of queued) callback(timestamp);
	};
	return { renderer, host, ownerWindow, canvas, frame, frames, request, cancel, draw, resize, styles, init, startTicker,
		onNodeHover, setWidth: (value: number) => { width = value; } };
}

describe("renderer host window", () => {
	test("owns the canvas and frame loop in the host window without restarting Pixi's global ticker", async () => {
		const { renderer, host, ownerWindow, canvas, frame, frames, init, startTicker, draw, styles } = await setup();
		try {
			expect(renderer.ownerWindow).toBe(ownerWindow);
			expect(canvas.ownerDocument).toBe(host.ownerDocument);
			expect(init).toHaveBeenCalledWith(expect.objectContaining({ canvas, autoStart: false, width: 640, height: 480 }));
			expect(styles).toHaveBeenCalledWith(host);
			expect(frames.size).toBe(1);
			frame(1000);
			expect(draw).toHaveBeenCalledOnce();
			frame(1016);
			expect(draw).toHaveBeenCalledOnce();
			frame(1500);
			expect(draw).toHaveBeenCalledTimes(2);
			expect(frames.size).toBe(1);
			expect(startTicker).not.toHaveBeenCalled();
		} finally { renderer.destroy(); }
	});

	test("pauses, resumes once and rejects an already queued old frame", async () => {
		const { renderer, frames, request, draw, frame } = await setup();
		try {
			const stale = [...frames.values()][0];
			renderer.pause();
			expect(frames.size).toBe(0);
			renderer.resume();
			renderer.resume();
			expect(request).toHaveBeenCalledTimes(2);
			expect(frames.size).toBe(1);
			stale(999);
			expect(draw).not.toHaveBeenCalled();
			expect(frames.size).toBe(1);
			frame(1000);
			expect(draw).toHaveBeenCalledOnce();
		} finally { renderer.destroy(); }
	});

	test("uses the captured window for pointer events and cleanup after DOM adoption", async () => {
		const { renderer, host, ownerWindow, onNodeHover, frames, cancel } = await setup();
		const event = () => new MouseEvent("pointermove", { clientX: 900, clientY: 700 });
		window.dispatchEvent(event());
		expect(onNodeHover).not.toHaveBeenCalled();
		ownerWindow.dispatchEvent(event());
		expect(onNodeHover).toHaveBeenCalledOnce();
		document.body.appendChild(host);
		renderer.destroy();
		expect(cancel).toHaveBeenCalledOnce();
		expect(frames.size).toBe(0);
		ownerWindow.dispatchEvent(event());
		expect(onNodeHover).toHaveBeenCalledOnce();
	});

	test("resizes via the renderer using the saved host without the global ResizePlugin", async () => {
		const { renderer, setWidth, resize } = await setup();
		try {
			setWidth(900);
			renderer.resize();
			expect(resize).toHaveBeenCalledExactlyOnceWith(900, 480);
			renderer.resize();
			expect(resize).toHaveBeenCalledOnce();
		} finally { renderer.destroy(); }
	});
});
