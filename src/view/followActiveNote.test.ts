import { describe, expect, it } from "vitest";
import { resolveFollowAction, type FollowContext } from "./followActiveNote";

/** Everything switched on and nothing in the way: the plain "center it" case. */
const READY: FollowContext = {
	enabled: true,
	graphVisible: true,
	exploring: false,
	focused: false,
	openedByGraph: false,
	inGraph: true,
	filteredOut: false,
};

describe("resolveFollowAction", () => {
	it("centers the camera on the note that just became active", () => {
		expect(resolveFollowAction(READY)).toBe("center");
	});

	it("does nothing while the toggle is off", () => {
		expect(resolveFollowAction({ ...READY, enabled: false })).toBe("ignore");
	});

	it("does nothing when the graph pane is not on screen", () => {
		expect(resolveFollowAction({ ...READY, graphVisible: false })).toBe("ignore");
	});

	it("does not chase a note the graph itself just opened", () => {
		// Otherwise clicking a node flies the camera to where it already is.
		expect(resolveFollowAction({ ...READY, openedByGraph: true })).toBe("ignore");
	});

	it("leaves explore mode alone — it drives the camera itself", () => {
		expect(resolveFollowAction({ ...READY, exploring: true })).toBe("ignore");
	});

	it("rebuilds the neighborhood instead of panning while focus mode is on", () => {
		expect(resolveFollowAction({ ...READY, focused: true })).toBe("refocus");
	});

	it("ignores a note that has no node — a non-markdown file, or a new one", () => {
		expect(resolveFollowAction({ ...READY, inGraph: false })).toBe("ignore");
	});

	it("ignores a note the active filter excludes, rather than clearing the filter", () => {
		expect(resolveFollowAction({ ...READY, filteredOut: true })).toBe("ignore");
	});

	it("keeps explore mode's claim on the camera even in focus mode", () => {
		expect(resolveFollowAction({ ...READY, focused: true, exploring: true })).toBe("ignore");
	});
});
