import { describe, expect, test } from "vitest";
import {
	DIM_ALPHA,
	FOG_FLOOR,
	HIGHLIGHT_SIZE_BOOST,
	HOVER_NEIGHBOR_ALPHA,
	HOVER_SIZE_BOOST,
	MIN_SIZE_DEPTH,
	emphasisBoost,
	fogFactor,
	mergeHiddenMask,
	nodeAlpha,
	sizeDepth,
} from "./nodeAppearance";

describe("sizeDepth", () => {
	test("a node behind the camera collapses to nothing", () => {
		expect(sizeDepth(0)).toBe(0);
		expect(sizeDepth(-1)).toBe(0);
	});

	test("a distant node stops shrinking at the floor", () => {
		expect(sizeDepth(0.01)).toBe(MIN_SIZE_DEPTH);
	});

	test("a near node keeps its perspective size", () => {
		expect(sizeDepth(2.5)).toBe(2.5);
	});
});

describe("fogFactor", () => {
	const FOCAL = 900;

	test("a node at the projection plane is unfogged", () => {
		expect(fogFactor(1, FOCAL)).toBe(1);
	});

	test("distant nodes fade but never below the floor", () => {
		expect(fogFactor(0.5, FOCAL)).toBeLessThan(1);
		expect(fogFactor(0.01, FOCAL)).toBe(FOG_FLOOR);
	});

	test("fog is monotone in depth across the far range", () => {
		const samples = [0.1, 0.3, 0.5, 0.7, 0.9, 1].map((d) => fogFactor(d, FOCAL));
		for (let i = 1; i < samples.length; i++) {
			expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
		}
	});

	test("a node about to cross the near plane dissolves to zero", () => {
		// depth = focal / distance, so distance 40 (the near plane) => depth 22.5
		expect(fogFactor(FOCAL / 40, FOCAL)).toBe(0);
		expect(fogFactor(FOCAL / 20, FOCAL)).toBe(0);
	});

	test("the near fade ramps up rather than popping", () => {
		const closer = fogFactor(FOCAL / 80, FOCAL);
		const farther = fogFactor(FOCAL / 200, FOCAL);
		expect(closer).toBeGreaterThan(0);
		expect(closer).toBeLessThan(1);
		expect(farther).toBeGreaterThan(closer);
	});
});

describe("emphasisBoost", () => {
	test("an ordinary node is drawn at its own size", () => {
		expect(emphasisBoost(false, false)).toBe(1);
	});

	test("a search match grows a little", () => {
		expect(emphasisBoost(false, true)).toBe(HIGHLIGHT_SIZE_BOOST);
	});

	test("hover wins over highlight", () => {
		expect(emphasisBoost(true, true)).toBe(HOVER_SIZE_BOOST);
	});
});

const BASE = {
	glow: 1,
	dimmed: false,
	factor: 1,
	fog: 1,
	hoverActive: false,
	isHovered: false,
	isHoverNeighbor: false,
};

describe("nodeAlpha", () => {
	test("a plain visible node is fully opaque", () => {
		expect(nodeAlpha(BASE)).toBe(1);
	});

	test("a filtered-out node drops to the dim alpha", () => {
		expect(nodeAlpha({ ...BASE, dimmed: true })).toBeCloseTo(DIM_ALPHA);
	});

	test("fog and focus fade multiply together", () => {
		expect(nodeAlpha({ ...BASE, fog: 0.5, factor: 0.4 })).toBeCloseTo(0.2);
	});

	test("the hovered node is opaque even when dimmed and fogged", () => {
		expect(
			nodeAlpha({ ...BASE, dimmed: true, fog: 0.2, hoverActive: true, isHovered: true })
		).toBe(1);
	});

	test("neighbours of the hovered node stay legible", () => {
		expect(
			nodeAlpha({ ...BASE, dimmed: true, hoverActive: true, isHoverNeighbor: true })
		).toBe(HOVER_NEIGHBOR_ALPHA);
	});

	test("a neighbour brighter than the floor keeps its own alpha", () => {
		expect(nodeAlpha({ ...BASE, hoverActive: true, isHoverNeighbor: true })).toBe(1);
	});

	test("hovering does not dim the rest of the scene", () => {
		// Regression: whole-scene dimming made every hover flash the graph.
		const idle = nodeAlpha({ ...BASE, fog: 0.7 });
		const whileHovering = nodeAlpha({ ...BASE, fog: 0.7, hoverActive: true });
		expect(whileHovering).toBe(idle);
	});
});

describe("mergeHiddenMask", () => {
	test("without depth information the user mask passes through untouched", () => {
		const hidden = new Uint8Array([1, 0, 0]);
		const { mask } = mergeHiddenMask(hidden, null, null);
		expect(mask).toBe(hidden);
	});

	test("nodes behind the camera are hidden alongside filtered ones", () => {
		const hidden = new Uint8Array([1, 0, 0]);
		const depths = new Float32Array([1, 0, 1]);

		const { mask } = mergeHiddenMask(hidden, depths, null);

		expect(Array.from(mask!)).toEqual([1, 1, 0]);
	});

	test("depth alone is enough to hide, with no user mask", () => {
		const { mask } = mergeHiddenMask(null, new Float32Array([0, 1]), null);
		expect(Array.from(mask!)).toEqual([1, 0]);
	});

	test("the scratch buffer is reused across frames", () => {
		const depths = new Float32Array([1, 0]);
		const first = mergeHiddenMask(null, depths, null);
		const second = mergeHiddenMask(null, depths, first.buffer);
		expect(second.buffer).toBe(first.buffer);
	});

	test("a resized graph gets a fresh buffer instead of a stale one", () => {
		const first = mergeHiddenMask(null, new Float32Array([1, 0]), null);
		const second = mergeHiddenMask(null, new Float32Array([1, 0, 1, 0]), first.buffer);
		expect(second.buffer).not.toBe(first.buffer);
		expect(second.buffer).toHaveLength(4);
	});
});
