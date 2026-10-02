import { describe, expect, test, vi } from "vitest";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

interface RendererHarness {
	findNodeAt(clientX: number, clientY: number): number | null;
	aimFromPointer(clientX: number, clientY: number): number | null;
	handlePointerDown(event: PointerEvent): void;
	handlePointerMove(event: PointerEvent): void;
	orbiting: boolean;
	viewport: { suppressPan: boolean } | null;
}

function callbacks() {
	const onNodeHover = vi.fn<RendererCallbacks["onNodeHover"]>();
	const onNodeClick = vi.fn<RendererCallbacks["onNodeClick"]>();
	const onExploreAim = vi.fn<RendererCallbacks["onExploreAim"]>();
	const onExploreJump = vi.fn<RendererCallbacks["onExploreJump"]>();
	const rendererCallbacks: RendererCallbacks = {
		onNodeHover,
		onNodeClick,
		onNodeDoubleClick: vi.fn(),
		onNodeMiddleClick: vi.fn(),
		onNodeContextMenu: vi.fn(),
		onNodeDragStart: vi.fn(),
		onNodeDrag: vi.fn(),
		onNodeDragEnd: vi.fn(),
		onLassoSelect: vi.fn(),
		onExploreAim,
		onExploreJump,
		onContextLost: vi.fn(),
	};
	return {
		rendererCallbacks,
		spies: { onNodeHover, onNodeClick, onExploreAim, onExploreJump },
	};
}

function pointer(): PointerEvent {
	return {
		button: 0,
		clientX: 120,
		clientY: 80,
		shiftKey: false,
		altKey: false,
		preventDefault: vi.fn(),
	} as unknown as PointerEvent;
}

function build(pickedId: number | null, candidateId: number | null) {
	const { rendererCallbacks, spies } = callbacks();
	const renderer = new GraphRenderer(rendererCallbacks);
	const harness = renderer as unknown as RendererHarness;
	harness.findNodeAt = vi.fn(() => pickedId);
	harness.aimFromPointer = vi.fn(() => candidateId);
	harness.viewport = { suppressPan: false };
	renderer.camera.enabled = true;
	renderer.setExploreOverlay({ centerId: 0, neighbors: [1], candidateId });
	return { renderer, harness, spies };
}

describe("Explore pointer handling", () => {
	test("a direct node pick clicks it without starting orbit", () => {
		const { harness, spies } = build(2, null);
		const event = pointer();

		harness.handlePointerDown(event);

		expect(spies.onNodeClick).toHaveBeenCalledWith(2, event);
		expect(spies.onExploreJump).not.toHaveBeenCalled();
		expect(harness.orbiting).toBe(false);
		expect(harness.viewport?.suppressPan).toBe(true);
	});

	test("a direct node pick wins over a stale armed link", () => {
		const { harness, spies } = build(2, 1);
		const event = pointer();

		harness.handlePointerDown(event);

		expect(spies.onNodeClick).toHaveBeenCalledWith(2, event);
		expect(spies.onExploreJump).not.toHaveBeenCalled();
	});

	test("pressing the current node does not follow a stale armed link", () => {
		const { harness, spies } = build(0, 1);

		harness.handlePointerDown(pointer());

		expect(spies.onNodeClick).not.toHaveBeenCalled();
		expect(spies.onExploreJump).not.toHaveBeenCalled();
		expect(harness.orbiting).toBe(false);
		expect(harness.viewport?.suppressPan).toBe(true);
	});

	test("an empty press follows an armed link", () => {
		const { harness, spies } = build(null, 1);

		harness.handlePointerDown(pointer());

		expect(spies.onExploreJump).toHaveBeenCalledOnce();
		expect(harness.orbiting).toBe(false);
		expect(harness.viewport?.suppressPan).toBe(true);
	});

	test("an empty press without an armed link starts orbit", () => {
		const { harness, spies } = build(null, null);

		harness.handlePointerDown(pointer());

		expect(spies.onNodeClick).not.toHaveBeenCalled();
		expect(spies.onExploreJump).not.toHaveBeenCalled();
		expect(harness.orbiting).toBe(true);
		expect(harness.viewport?.suppressPan).toBe(true);
	});

	test("hovering an unrelated node shows it without arming a link", () => {
		const { harness, spies } = build(2, 1);
		const event = pointer();

		harness.handlePointerMove(event);

		expect(spies.onNodeHover).toHaveBeenCalledWith(2, event.clientX, event.clientY);
		expect(spies.onExploreAim).toHaveBeenCalledWith(null, event.clientX, event.clientY);
		expect(spies.onExploreAim.mock.invocationCallOrder[0])
			.toBeLessThan(spies.onNodeHover.mock.invocationCallOrder[0]);
	});

	test("hovering empty space keeps the aimed-link signpost", () => {
		const { harness, spies } = build(null, 1);
		const event = pointer();

		harness.handlePointerMove(event);

		expect(spies.onExploreAim).toHaveBeenCalledWith(1, event.clientX, event.clientY);
		expect(spies.onNodeHover).not.toHaveBeenCalled();
	});
});
