// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { ClickDispatcher } from "./clickDispatcher";

beforeAll(() => installObsidianDom());

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function createHostWindow(): { frame: HTMLIFrameElement; window: Window } {
	const frame = document.body.createEl("iframe");
	return { frame, window: frame.contentWindow as Window };
}

describe("ClickDispatcher host window", () => {
	test("clears a pending timer in its original window after the provider changes", () => {
		const first = createHostWindow();
		const second = createHostWindow();
		const firstSet = vi.spyOn(first.window, "setTimeout").mockReturnValue(31);
		const firstClear = vi.spyOn(first.window, "clearTimeout").mockImplementation(() => undefined);
		const secondClear = vi.spyOn(second.window, "clearTimeout").mockImplementation(() => undefined);
		let ownerWindow = first.window;
		const dispatcher = new ClickDispatcher(
			{ onClick: vi.fn(), onDoubleClick: vi.fn() },
			50,
			() => ownerWindow
		);

		dispatcher.press(7, {} as PointerEvent);
		expect(firstSet).toHaveBeenCalledOnce();
		ownerWindow = second.window;
		dispatcher.cancel();

		expect(firstClear).toHaveBeenCalledWith(31);
		expect(secondClear).not.toHaveBeenCalled();
		first.frame.remove();
		second.frame.remove();
	});
});
