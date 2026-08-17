// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClickDispatcher, DOUBLE_CLICK_MS } from "./clickDispatcher";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const event = {} as PointerEvent;

function build() {
	const onClick = vi.fn();
	const onDoubleClick = vi.fn();
	const dispatcher = new ClickDispatcher({ onClick, onDoubleClick });
	return { dispatcher, onClick, onDoubleClick };
}

describe("ClickDispatcher (F-02)", () => {
	test("a single click is delivered only after the double-click window", () => {
		const { dispatcher, onClick } = build();
		dispatcher.press(7, event);
		expect(onClick).not.toHaveBeenCalled();
		vi.advanceTimersByTime(DOUBLE_CLICK_MS);
		expect(onClick).toHaveBeenCalledWith(7, event);
	});

	test("two quick clicks on one node fire a double-click and no single click", () => {
		const { dispatcher, onClick, onDoubleClick } = build();
		dispatcher.press(7, event);
		vi.advanceTimersByTime(DOUBLE_CLICK_MS - 50);
		dispatcher.press(7, event);
		vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);
		expect(onDoubleClick).toHaveBeenCalledTimes(1);
		expect(onDoubleClick).toHaveBeenCalledWith(7);
		expect(onClick).not.toHaveBeenCalled();
	});

	test("a quick click on a different node flushes the first as a single click", () => {
		const { dispatcher, onClick, onDoubleClick } = build();
		dispatcher.press(7, event);
		dispatcher.press(8, event);
		expect(onClick).toHaveBeenCalledWith(7, event);
		vi.advanceTimersByTime(DOUBLE_CLICK_MS);
		expect(onClick).toHaveBeenCalledWith(8, event);
		expect(onDoubleClick).not.toHaveBeenCalled();
	});

	test("a slow second click on the same node is two single clicks", () => {
		const { dispatcher, onClick, onDoubleClick } = build();
		dispatcher.press(7, event);
		vi.advanceTimersByTime(DOUBLE_CLICK_MS);
		dispatcher.press(7, event);
		vi.advanceTimersByTime(DOUBLE_CLICK_MS);
		expect(onClick).toHaveBeenCalledTimes(2);
		expect(onDoubleClick).not.toHaveBeenCalled();
	});

	test("cancel drops a pending click without delivering it", () => {
		const { dispatcher, onClick } = build();
		dispatcher.press(7, event);
		dispatcher.cancel();
		vi.advanceTimersByTime(DOUBLE_CLICK_MS * 2);
		expect(onClick).not.toHaveBeenCalled();
	});
});
