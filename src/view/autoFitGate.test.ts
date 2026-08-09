import { describe, expect, it } from "vitest";
import { AutoFitGate, shouldFitOnSettle } from "./autoFitGate";

describe("AutoFitGate", () => {
	it("fits once after a request", () => {
		const gate = new AutoFitGate();

		gate.request();

		expect(gate.consume()).toBe(true);
	});

	it("does not fit when nothing was requested", () => {
		const gate = new AutoFitGate();

		expect(gate.consume()).toBe(false);
	});

	it("fits only once per request", () => {
		const gate = new AutoFitGate();

		gate.request();
		gate.consume();

		expect(gate.consume()).toBe(false);
	});

	it("does not fit after the user took over the camera", () => {
		const gate = new AutoFitGate();

		gate.request();
		gate.cancel();

		expect(gate.consume()).toBe(false);
	});

	it("fits again on a fresh request after a cancel", () => {
		const gate = new AutoFitGate();

		gate.request();
		gate.cancel();
		gate.request();

		expect(gate.consume()).toBe(true);
	});
});

describe("shouldFitOnSettle", () => {
	it("fits a settled 2D layout when a fit is pending", () => {
		const gate = new AutoFitGate();
		gate.request();

		expect(shouldFitOnSettle(gate, false)).toBe(true);
	});

	it("never fits in 3D — the tuned view starts inside the galaxy", () => {
		const gate = new AutoFitGate();
		gate.request();

		expect(shouldFitOnSettle(gate, true)).toBe(false);
	});

	it("drops the pending fit in 3D so a later 2D settle does not fire it stale", () => {
		const gate = new AutoFitGate();
		gate.request();

		shouldFitOnSettle(gate, true);

		expect(shouldFitOnSettle(gate, false)).toBe(false);
	});

	it("stays quiet in 2D with nothing pending", () => {
		expect(shouldFitOnSettle(new AutoFitGate(), false)).toBe(false);
	});
});
