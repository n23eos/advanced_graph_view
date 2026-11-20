import { describe, expect, test } from "vitest";
import { statusBarInset } from "./FloatingLayout";

const box = (left: number, top: number, right: number, bottom: number) =>
	({ left, top, right, bottom, width: right - left, height: bottom - top });

/** A graph pane filling the window down to y = 800. */
const HOST = box(0, 0, 1200, 800);

describe("statusBarInset", () => {
	test("a bar floating over the bottom-right corner lifts the widget by its height", () => {
		expect(statusBarInset(HOST, box(950, 775, 1200, 800))).toBe(25);
	});

	test("a bar docked below the view needs no room", () => {
		expect(statusBarInset(HOST, box(0, 800, 1200, 825))).toBe(0);
	});

	test("a hidden or missing bar needs no room", () => {
		expect(statusBarInset(HOST, null)).toBe(0);
		expect(statusBarInset(HOST, box(0, 0, 0, 0))).toBe(0);
	});

	test("a bar over another pane's corner is ignored", () => {
		// Graph in the left half of a split; the bar sits under the right half.
		expect(statusBarInset(box(0, 0, 600, 800), box(950, 775, 1200, 800))).toBe(0);
	});

	test("a graph pane that ends above the bar is not lifted", () => {
		expect(statusBarInset(box(0, 0, 1200, 400), box(950, 775, 1200, 800))).toBe(0);
	});

	test("a bar that spans the full width but floats still counts", () => {
		expect(statusBarInset(HOST, box(0, 778, 1200, 800))).toBe(22);
	});

	test("the lift is capped so a broken theme cannot fling the widget up the view", () => {
		expect(statusBarInset(HOST, box(950, 100, 1200, 800))).toBe(80);
	});
});
