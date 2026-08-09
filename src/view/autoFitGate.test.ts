import { describe, expect, it } from "vitest";
import { AutoFitGate } from "./autoFitGate";

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
