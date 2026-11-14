// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { GraphInsightView } from "./GraphView";

vi.mock("obsidian", async (original) => ({
	...await original<typeof import("obsidian")>(),
	ItemView: class {},
	debounce: (callback: () => void) => callback,
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

test("disconnects visibility observation before awaiting position persistence", async () => {
	let finish!: () => void;
	const savePositions = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
	const stop = vi.fn();
	const view = new GraphInsightView({} as WorkspaceLeaf, { flushSettings: async () => {} } as never);
	Object.assign(view, { savePositions, stopObservingRendererVisibility: stop });
	const closing = view.onClose();
	expect(stop).toHaveBeenCalledOnce();
	expect(stop.mock.invocationCallOrder[0]).toBeLessThan(savePositions.mock.invocationCallOrder[0]);
	finish();
	await closing;
});
