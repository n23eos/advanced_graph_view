import { describe, expect, it } from "vitest";
import { resolvePreset } from "../encoding/colorScales";
import { ringTints } from "./ringTints";

const GALAXY = resolvePreset("galaxy");

describe("ringTints", () => {
	it("gives one tint per node", () => {
		const tints = ringTints(Int16Array.from([0, 1, 1, 2]), 2, GALAXY);

		expect(tints).toHaveLength(4);
	});

	it("paints the root the brightest end of the scale", () => {
		const tints = ringTints(Int16Array.from([0, 1, 2]), 2, GALAXY);

		expect(tints[0]).toBe(GALAXY.stops[GALAXY.stops.length - 1]);
	});

	it("gives every ring its own color", () => {
		const tints = ringTints(Int16Array.from([0, 1, 2, 3]), 3, GALAXY);

		expect(new Set(tints).size).toBe(4);
	});

	it("paints nodes at the same depth the same color", () => {
		const tints = ringTints(Int16Array.from([1, 1, 2]), 2, GALAXY);

		expect(tints[0]).toBe(tints[1]);
		expect(tints[0]).not.toBe(tints[2]);
	});

	it("keeps a depth-0-only neighborhood on the bright end", () => {
		const tints = ringTints(Int16Array.from([0]), 0, GALAXY);

		expect(tints[0]).toBe(GALAXY.stops[GALAXY.stops.length - 1]);
	});
});
