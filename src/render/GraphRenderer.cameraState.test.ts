// @vitest-environment jsdom
import { Container } from "pixi.js";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { CameraState } from "../view/workspaceState";
import { installObsidianDom } from "../test/obsidianDom";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";
import { Viewport } from "./Viewport";

const saved: CameraState = {
	viewport: { centerX: 45, centerY: -30, scale: 1.25, referenceScale: 0.5 },
	camera3d: {
		position: { x: 10, y: 20, z: -400 },
		pivot: { x: 3, y: 4, z: 5 },
		yaw: 0.7,
		pitch: -0.35,
	},
};

beforeAll(() => installObsidianDom());

function harness(width: number, height: number) {
	const onCameraChanged = vi.fn();
	const renderer = new GraphRenderer({ onCameraChanged } as unknown as RendererCallbacks);
	const internal = renderer as unknown as {
		app: {
			screen: { width: number; height: number };
			renderer: { resize(nextWidth: number, nextHeight: number): void };
		} | null;
		host: HTMLElement | null;
		world: Container;
		viewport: Viewport | null;
		handleViewportChanged(): void;
		handleWheel(event: WheelEvent): void;
		handlePointerMove(event: PointerEvent): void;
		rmbPanning: boolean;
		rmbLastX: number;
		rmbLastY: number;
		orbiting: boolean;
		orbitLastX: number;
		orbitLastY: number;
	};
	const screen = { width, height };
	internal.app = {
		screen,
		renderer: {
			resize(nextWidth, nextHeight) {
				screen.width = nextWidth;
				screen.height = nextHeight;
			},
		},
	};
	internal.viewport = new Viewport(
		internal.world,
		document.body.createEl("canvas"),
		() => internal.handleViewportChanged()
	);
	return { renderer, internal, onCameraChanged };
}

describe("GraphRenderer camera workspace state", () => {
	test("returns null before its logical viewport exists", () => {
		const renderer = new GraphRenderer({} as RendererCallbacks);
		expect(renderer.getCameraState()).toBeNull();
	});

	test("round-trips 2D and 3D fields without changing the configured mode or reporting interaction", () => {
		const { renderer, internal, onCameraChanged } = harness(800, 600);
		const reopened = harness(1200, 900);
		try {
			renderer.camera.enabled = false;
			renderer.restoreCameraState(saved);

			expect(renderer.camera.enabled).toBe(false);
			expect(renderer.getCameraState()).toEqual(saved);
			expect(onCameraChanged).not.toHaveBeenCalled();

			reopened.renderer.camera.enabled = false;
			reopened.renderer.restoreCameraState(renderer.getCameraState()!);
			expect(reopened.renderer.getCameraState()).toEqual(saved);
			expect(reopened.onCameraChanged).not.toHaveBeenCalled();
		} finally {
			internal.viewport?.destroy();
			internal.world.destroy();
			reopened.internal.viewport?.destroy();
			reopened.internal.world.destroy();
		}
	});

	test("preserves a restored 2D center when a hidden leaf receives its first real size", () => {
		const { renderer, internal, onCameraChanged } = harness(1, 1);
		const host = document.body.createDiv();
		Object.defineProperties(host, {
			clientWidth: { value: 800 },
			clientHeight: { value: 600 },
		});
		internal.host = host;
		try {
			renderer.camera.enabled = false;
			renderer.restoreCameraState(saved);
			renderer.resize();

			expect(renderer.getCameraState()).toEqual(saved);
			expect(onCameraChanged).not.toHaveBeenCalled();
		} finally {
			internal.viewport?.destroy();
			internal.world.destroy();
			host.remove();
		}
	});

	test("reports camera placement but not layout position frames", () => {
		const onCameraChanged = vi.fn();
		const renderer = new GraphRenderer({ onCameraChanged } as unknown as RendererCallbacks);

		renderer.placeCamera({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
		expect(onCameraChanged).toHaveBeenCalledOnce();

		onCameraChanged.mockClear();
		for (let index = 0; index < 100; index++) {
			renderer.updatePositions(new Float32Array([index, index + 1, index + 2]));
		}
		expect(onCameraChanged).not.toHaveBeenCalled();
	});

	test("reports viewport, fly, strafe and orbit camera interactions", () => {
		const { renderer, internal, onCameraChanged } = harness(800, 600);
		try {
			internal.viewport!.centerOn(20, 30, 800, 600);
			expect(onCameraChanged).toHaveBeenCalledOnce();

			onCameraChanged.mockClear();
			renderer.camera.enabled = true;
			internal.handleWheel({
				deltaY: 10,
				preventDefault: vi.fn(),
				stopImmediatePropagation: vi.fn(),
			} as unknown as WheelEvent);
			expect(onCameraChanged).toHaveBeenCalledOnce();

			onCameraChanged.mockClear();
			internal.rmbPanning = true;
			internal.rmbLastX = 0;
			internal.rmbLastY = 0;
			internal.handlePointerMove(new PointerEvent("pointermove", { clientX: 10, clientY: 5 }));
			expect(onCameraChanged).toHaveBeenCalledOnce();

			onCameraChanged.mockClear();
			internal.rmbPanning = false;
			internal.orbiting = true;
			internal.orbitLastX = 0;
			internal.orbitLastY = 0;
			internal.handlePointerMove(new PointerEvent("pointermove", { clientX: 10, clientY: 5 }));
			expect(onCameraChanged).toHaveBeenCalledOnce();
		} finally {
			internal.viewport?.destroy();
			internal.world.destroy();
		}
	});
});
