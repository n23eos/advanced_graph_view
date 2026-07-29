import { describe, expect, test } from "vitest";
import { DEAD_ZONE_PX, MAX_AIM_ANGLE, pickAimedNeighbor } from "./aiming";

/**
 * Build a projected-position array from {x, y} pairs, so a test reads as a
 * picture of the screen rather than as index arithmetic.
 */
function screen(points: { x: number; y: number }[]): Float32Array {
	const positions = new Float32Array(points.length * 2);
	points.forEach((point, index) => {
		positions[index * 2] = point.x;
		positions[index * 2 + 1] = point.y;
	});
	return positions;
}

/** Node 0 sits at the origin; neighbours 1..n fan out around it. */
const CENTER = { x: 0, y: 0 };
const EAST = { x: 100, y: 0 };
const NORTH = { x: 0, y: -100 };
const WEST = { x: -100, y: 0 };

function aim(
	points: { x: number; y: number }[],
	pointerX: number,
	pointerY: number,
	overrides: Partial<Parameters<typeof pickAimedNeighbor>[0]> = {}
) {
	return pickAimedNeighbor({
		positions: screen(points),
		centerId: 0,
		neighbors: points.map((_, index) => index).filter((index) => index !== 0),
		pointerX,
		pointerY,
		deadZone: DEAD_ZONE_PX,
		maxAngle: MAX_AIM_ANGLE,
		...overrides,
	});
}

describe("aiming down a link", () => {
	test("the neighbour the pointer points at wins", () => {
		expect(aim([CENTER, EAST, NORTH, WEST], 80, 0)).toBe(1);
		expect(aim([CENTER, EAST, NORTH, WEST], 0, -80)).toBe(2);
		expect(aim([CENTER, EAST, NORTH, WEST], -80, 0)).toBe(3);
	});

	test("aiming works past the neighbour, not only between it and the center", () => {
		// Pointing further out along the same ray is still pointing at it —
		// the link is a direction, not a segment to land inside of.
		expect(aim([CENTER, EAST], 500, 0)).toBe(1);
	});

	test("a small angle off the link still counts", () => {
		// ~10° off east, inside the 25° tolerance.
		expect(aim([CENTER, EAST], 100, 17)).toBe(1);
	});

	test("pointing between two links picks the closer one in angle", () => {
		const northEast = { x: 100, y: -100 }; // 45° up from east
		// The pointer sits 30° up: 15° from north-east, 30° from east.
		expect(aim([CENTER, EAST, northEast], 100, -58)).toBe(2);
	});
});

describe("refusing to guess", () => {
	test("no target while the pointer sits on the current node", () => {
		expect(aim([CENTER, EAST], 5, 5)).toBeNull();
	});

	test("the dead zone ends exactly at its radius", () => {
		expect(aim([CENTER, EAST], DEAD_ZONE_PX - 1, 0)).toBeNull();
		expect(aim([CENTER, EAST], DEAD_ZONE_PX + 1, 0)).toBe(1);
	});

	test("pointing away from every link targets nothing", () => {
		// East is the only link; the pointer is 90° off it.
		expect(aim([CENTER, EAST], 0, 100)).toBeNull();
	});

	test("a node with no links has nothing to aim at", () => {
		expect(aim([CENTER], 100, 0)).toBeNull();
	});

	test("the tolerance is a hard edge", () => {
		const inside = Math.tan(MAX_AIM_ANGLE - 0.02) * 100;
		const outside = Math.tan(MAX_AIM_ANGLE + 0.02) * 100;
		expect(aim([CENTER, EAST], 100, inside)).toBe(1);
		expect(aim([CENTER, EAST], 100, outside)).toBeNull();
	});
});

describe("skipping neighbours that are not really on screen", () => {
	test("filtered-out neighbours are not targets", () => {
		const hiddenMask = new Uint8Array([0, 1, 0]);
		// East is hidden, so the pointer aimed at it finds nothing…
		expect(aim([CENTER, EAST, NORTH], 100, 0, { hiddenMask })).toBeNull();
		// …while the visible one still works.
		expect(aim([CENTER, EAST, NORTH], 0, -100, { hiddenMask })).toBe(2);
	});

	test("neighbours behind the camera are not targets", () => {
		// depthScale 0 = the projection dropped it; its screen position is stale.
		const depthScales = new Float32Array([1, 0, 1]);
		expect(aim([CENTER, EAST, NORTH], 100, 0, { depthScales })).toBeNull();
	});

	test("a neighbour drawn on top of the center is not a direction", () => {
		// Zero-length link: atan2(0, 0) is meaningless, so it must be skipped
		// rather than silently answering "east".
		expect(aim([CENTER, CENTER], 100, 0)).toBeNull();
	});
});

describe("links that overlap", () => {
	test("two links along one ray resolve by distance to the pointer", () => {
		const near = { x: 100, y: 0 };
		const far = { x: 400, y: 0 };
		expect(aim([CENTER, near, far], 120, 0)).toBe(1);
		expect(aim([CENTER, near, far], 380, 0)).toBe(2);
	});

	test("a clearly better angle beats a better distance", () => {
		const nearButOff = { x: 100, y: -40 }; // ~22° off
		const farButStraight = { x: 900, y: 0 }; // dead on
		expect(aim([CENTER, nearButOff, farButStraight], 100, 0)).toBe(2);
	});
});
