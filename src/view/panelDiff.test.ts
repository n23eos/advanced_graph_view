import { describe, expect, test } from "vitest";
import type { PanelState } from "../ui/ControlPanel";
import { DEFAULT_3D_PANEL } from "./builtinPresets";
import { panelDiff, type PanelDiff } from "./panelDiff";

const none: PanelDiff = {
	applyEncoding: false,
	applyOverlays: false,
	redrawBubbles: false,
	syncTimelineAndTrail: false,
};

function state(change: Partial<PanelState> = {}): PanelState {
	return { ...DEFAULT_3D_PANEL, ...change };
}

describe("panel state diff", () => {
	test("fully applies a panel state without a previous value", () => {
		expect(panelDiff(undefined, state())).toEqual({
			applyEncoding: true,
			applyOverlays: true,
			redrawBubbles: true,
			syncTimelineAndTrail: true,
		});
	});

	test("skips expensive work for an unchanged or unrelated slice", () => {
		const prev = state();
		expect(panelDiff(prev, prev)).toEqual(none);
		expect(panelDiff(prev, { ...prev, physics: { ...prev.physics, repel: prev.physics.repel + 1 } })).toEqual(none);
	});

	test.each([
		["channels", (prev: PanelState) => ({ ...prev, channels: { ...prev.channels } })],
		["color preset", (prev: PanelState) => ({ ...prev, colorPreset: "heat" })],
		["node style", (prev: PanelState) => ({ ...prev, nodeStyle: "ring" as const })],
		["node scale", (prev: PanelState) => ({ ...prev, nodeScale: prev.nodeScale + 0.1 })],
	] as const)("re-encodes and refreshes bubbles when %s changes", (_name, change) => {
		const prev = state();
		expect(panelDiff(prev, change(prev))).toEqual({
			...none,
			applyEncoding: true,
			redrawBubbles: true,
		});
	});

	test("recomputes overlays when their reference changes", () => {
		const prev = state();
		expect(panelDiff(prev, { ...prev, overlays: { ...prev.overlays } })).toEqual({
			...none,
			applyOverlays: true,
		});
	});

	test("redraws bubbles when their visibility changes", () => {
		const prev = state();
		expect(panelDiff(prev, { ...prev, showBubbles: !prev.showBubbles })).toEqual({
			...none,
			redrawBubbles: true,
		});
	});

	test.each(["showTimeline", "showTrail"] as const)("syncs timeline and trail when %s changes", (field) => {
		const prev = state();
		expect(panelDiff(prev, { ...prev, [field]: !prev[field] })).toEqual({
			...none,
			syncTimelineAndTrail: true,
		});
	});
});
