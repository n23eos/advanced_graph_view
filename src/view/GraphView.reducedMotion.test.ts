// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { GraphInsightView } from "./GraphView";
import { buildGraphModel } from "../data/GraphStore";

vi.mock("obsidian", async (original) => ({ ...await original<typeof import("obsidian")>(), ItemView: class {} }));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

afterEach(() => vi.restoreAllMocks());

function harness(reduced: boolean) {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({ matches: reduced })),
	});
	const frames: FrameRequestCallback[] = [];
	const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return 8;
	});
	const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
	const renderTrail = vi.fn();
	const view = Object.assign(Object.create(GraphInsightView.prototype) as {
		replayTrail(): void;
		trailReplayFrame: number | null;
	}, {
		trailReplayFrame: 7,
		model: buildGraphModel(["a.md", "b.md"], {}, {}),
		plugin: { sessionTrail: [{ path: "a.md", ts: 1 }, { path: "b.md", ts: 2 }] },
		renderer: { setSessionTrail: renderTrail },
	});
	return { view, frames, request, cancel, renderTrail };
}

describe("reduced motion trail replay", () => {
	test("draws the complete trail immediately and cancels pending animation", () => {
		const { view, request, cancel, renderTrail } = harness(true);
		view.replayTrail();
		expect(cancel).toHaveBeenCalledWith(7);
		expect(renderTrail).toHaveBeenCalledExactlyOnceWith([0, 1], 1);
		expect(request).not.toHaveBeenCalled();
		expect(view.trailReplayFrame).toBeNull();
	});

	test("keeps the existing timed replay when motion is allowed", () => {
		const { view, frames, request, renderTrail } = harness(false);
		vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(2100);
		view.replayTrail();
		expect(renderTrail).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledOnce();
		frames[0](2100);
		expect(renderTrail).toHaveBeenCalledExactlyOnceWith([0, 1], 0.5);
	});
});
