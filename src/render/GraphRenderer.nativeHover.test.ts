import { describe, expect, test, vi } from "vitest";
import { GraphRenderer, type RendererCallbacks } from "./GraphRenderer";

function setup(explore = false) {
	const preview = vi.fn(); const hover = vi.fn();
	const callbacks = {
		onNodePreview: preview, onNodeHover: hover, onExploreAim: vi.fn(),
	} as unknown as RendererCallbacks;
	const renderer = new GraphRenderer(callbacks);
	const harness = renderer as unknown as {
		findNodeAt: () => number | null;
		handlePointerMove(event: PointerEvent): void;
		hoveredId: number | null;
		explore: { centerId: number; neighbors: number[] } | null;
		rmbPanning: boolean;
	};
	harness.findNodeAt = () => 2;
	harness.hoveredId = 2;
	if (explore) harness.explore = { centerId: 0, neighbors: [2] };
	return { harness, preview, hover };
}
const event = { clientX: 12, clientY: 24, ctrlKey: true, buttons: 0 } as PointerEvent;

describe("native preview pointer routing", () => {
	test.each([false, true])("routes picked nodes and original event in Explore=%s without changing tooltip API", (explore) => {
		const h = setup(explore);
		h.harness.handlePointerMove(event);
		expect(h.preview).toHaveBeenCalledExactlyOnceWith(2, event);
		expect(h.hover).toHaveBeenCalledExactlyOnceWith(2, 12, 24);
	});

	test("reports empty space while retaining Explore tooltip behavior", () => {
		const h = setup(true);
		h.harness.findNodeAt = () => null;
		h.harness.handlePointerMove(event);
		expect(h.preview).toHaveBeenCalledExactlyOnceWith(null, event);
		expect(h.hover).not.toHaveBeenCalled();
	});
});
