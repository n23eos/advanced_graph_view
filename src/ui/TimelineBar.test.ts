// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { TimelineBar } from "./TimelineBar";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.empty();
});

function build() {
	const host = document.body.createDiv();
	const onCutoffChange = vi.fn();
	const onModeChange = vi.fn(() => bar.setTimestamps([
		Date.UTC(2026, 3, 1), Date.UTC(2026, 5, 1),
	]));
	const bar = new TimelineBar(host, { onCutoffChange, onModeChange });
	bar.setTimestamps([Date.UTC(2026, 0, 1), Date.UTC(2026, 2, 1)]);
	bar.show();
	return {
		host, bar, onCutoffChange, onModeChange,
		slider: host.querySelector("input")!,
		play: host.querySelector("button")!,
		mode: host.querySelector("select")!,
	};
}

describe("timeline state continuity", () => {
	test("changing date mode resets both the displayed month and the applied cutoff", () => {
		const { host, slider, mode, onCutoffChange } = build();
		slider.value = "0";
		slider.dispatchEvent(new Event("input"));
		expect(onCutoffChange).toHaveBeenLastCalledWith(Date.UTC(2026, 1, 1));
		mode.value = "modified";
		mode.dispatchEvent(new Event("change"));
		expect(slider.value).toBe(slider.max);
		expect(host.querySelector(".graph-insight-timeline-label")?.textContent).toBe("06.2026");
		expect(onCutoffChange).toHaveBeenLastCalledWith(null);
	});

	test("play from the end immediately applies the first month and stops at the last", () => {
		const { slider, play, onCutoffChange } = build();
		play.click();
		expect(slider.value).toBe("0");
		expect(slider.getAttribute("aria-valuetext")).toBe("01.2026");
		expect(onCutoffChange).toHaveBeenLastCalledWith(Date.UTC(2026, 1, 1));
		expect(play.getAttribute("aria-pressed")).toBe("true");
		vi.advanceTimersByTime(2000);
		expect(onCutoffChange).toHaveBeenLastCalledWith(null);
		expect(play.getAttribute("aria-pressed")).toBe("false");
		expect(vi.getTimerCount()).toBe(0);
	});

	test("replacing dates stops playback and cannot reapply the old cutoff", () => {
		const { bar, play, onCutoffChange } = build();
		play.click();
		bar.setTimestamps([Date.UTC(2026, 3, 1), Date.UTC(2026, 5, 1)]);
		onCutoffChange.mockClear();
		vi.advanceTimersByTime(5000);
		expect(onCutoffChange).not.toHaveBeenCalled();
		expect(play.getAttribute("aria-pressed")).toBe("false");
	});

	test("hiding resets the displayed month as well as the filter", () => {
		const { bar, play, slider, onCutoffChange } = build();
		play.click();
		bar.hide();
		bar.show();
		expect(slider.value).toBe(slider.max);
		expect(onCutoffChange).toHaveBeenLastCalledWith(null);
		expect(vi.getTimerCount()).toBe(0);
	});

	test.each([{ dates: [] }, { dates: [Date.UTC(2026, 0, 1)] }])("no playback for a range with fewer than two months: $dates", ({ dates }) => {
		const { bar, play, slider } = build();
		bar.setTimestamps(dates);
		expect(play.disabled).toBe(true);
		expect(slider.disabled).toBe(true);
		play.click();
		expect(vi.getTimerCount()).toBe(0);
	});

	test("destroy cancels active playback", () => {
		const { bar, play, onCutoffChange } = build();
		play.click();
		bar.destroy();
		onCutoffChange.mockClear();
		vi.advanceTimersByTime(5000);
		expect(onCutoffChange).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
