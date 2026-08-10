import { describe, expect, it } from "vitest";
import { isMeaningfulResize } from "./resizeGate";

describe("isMeaningfulResize", () => {
	it("accepts a real pane resize", () => {
		expect(isMeaningfulResize(900, 600, 500, 600)).toBe(true);
	});

	it("ignores sub-pixel jitter from scrollbars and pane-edge hovers", () => {
		expect(isMeaningfulResize(901, 600, 900, 600)).toBe(false);
	});

	it("ignores a hidden pane collapsing to zero width", () => {
		// Switching to a note hides the graph tab: the host reports 0×0. Acting
		// on that recentered the world on the top-left pixel and the graph came
		// back stuck in the corner.
		expect(isMeaningfulResize(0, 0, 900, 600)).toBe(false);
	});

	it("ignores a zero in either dimension on its own", () => {
		expect(isMeaningfulResize(0, 600, 900, 600)).toBe(false);
		expect(isMeaningfulResize(900, 0, 900, 600)).toBe(false);
	});

	it("accepts the pane coming back at a new size", () => {
		expect(isMeaningfulResize(700, 600, 900, 600)).toBe(true);
	});
});
