import { describe, expect, test } from "vitest";
import {
	EDGE_PULSE_ARRIVAL_MS,
	EDGE_PULSE_LIMIT,
	EDGE_PULSE_TRAVEL_MS,
	edgePulsePhase,
	pulseDelay,
	selectPulseEdges,
	slicePackedPath,
} from "./edgePulse";

describe("edge pulse scheduling", () => {
	test("bounds hubs with a stable sample spread across all incident links", () => {
		const incident = Array.from({ length: 601 }, (_, index) => index);
		const selected = selectPulseEdges(incident);

		expect(selected).toHaveLength(EDGE_PULSE_LIMIT);
		expect(selected[0]).toBeGreaterThan(0);
		expect(selected.at(-1)).toBeGreaterThan(580);
		expect(selectPulseEdges(incident)).toEqual(selected);
	});

	test("moves a short tail, then emits and finishes an arrival glow", () => {
		expect(edgePulsePhase(-1)).toMatchObject({ visible: false, done: false });
		expect(edgePulsePhase(EDGE_PULSE_TRAVEL_MS / 2)).toMatchObject({
			visible: true,
			done: false,
			head: 0.5,
			tail: 0.3,
			arrival: 0,
		});
		expect(edgePulsePhase(EDGE_PULSE_TRAVEL_MS + EDGE_PULSE_ARRIVAL_MS / 2).arrival).toBeCloseTo(1);
		expect(edgePulsePhase(EDGE_PULSE_TRAVEL_MS + EDGE_PULSE_ARRIVAL_MS + 1)).toMatchObject({
			visible: false,
			done: true,
		});
	});

	test("staggers a burst within the fixed short window", () => {
		expect(pulseDelay(0, 36)).toBe(0);
		expect(pulseDelay(35, 36)).toBe(90);
	});
});

describe("edge pulse path", () => {
	const points = new Float32Array([0, 0, 10, 0, 10, 30]);

	test("follows arc length through the actual packed curve", () => {
		const slice = slicePackedPath({ points, offset: 0, pointCount: 3, reversed: false }, 0.125, 0.5);

		expect(slice).toEqual([5, 0, 10, 0, 10, 10]);
	});

	test("travels away from the hovered endpoint even for an incoming edge", () => {
		const slice = slicePackedPath({ points, offset: 0, pointCount: 3, reversed: true }, 0, 0.25);

		expect(slice).toEqual([10, 30, 10, 20]);
	});

	test("returns no geometry for a collapsed hidden edge", () => {
		const slice = slicePackedPath({ points: new Float32Array([1, 1]), offset: 0, pointCount: 1, reversed: false }, 0, 1);

		expect(slice).toEqual([]);
	});
});
