import { describe, expect, test } from "vitest";
import { computeOverlayMask, countOverlayMatches } from "./overlays";
import { buildGraphModel } from "../data/GraphStore";

// hub -> x, hub -> ghost (unresolved); lonely has no links at all
const model = buildGraphModel(
	["hub.md", "x.md", "lonely.md"],
	{ "hub.md": { "x.md": 1 } },
	{ "hub.md": { Ghost: 2 } }
);

describe("computeOverlayMask", () => {
	test("orphans are nodes without inbound links", () => {
		// Act
		const mask = computeOverlayMask(model, { orphans: true, deadEnds: false, broken: false });

		// Assert: hub (no inbound) and lonely are orphans, x is not
		expect(Array.from(mask!)).toEqual([1, 0, 1]);
	});

	test("dead ends are nodes without outbound links", () => {
		// Act
		const mask = computeOverlayMask(model, { orphans: false, deadEnds: true, broken: false });

		// Assert
		expect(Array.from(mask!)).toEqual([0, 1, 1]);
	});

	test("broken marks nodes with unresolved links", () => {
		// Act
		const mask = computeOverlayMask(model, { orphans: false, deadEnds: false, broken: true });

		// Assert
		expect(Array.from(mask!)).toEqual([1, 0, 0]);
	});

	test("multiple overlays union their matches", () => {
		// Act
		const mask = computeOverlayMask(model, { orphans: true, deadEnds: false, broken: true });

		// Assert
		expect(Array.from(mask!)).toEqual([1, 0, 1]);
	});

	test("no active overlays return null (nothing dimmed)", () => {
		expect(computeOverlayMask(model, { orphans: false, deadEnds: false, broken: false })).toBeNull();
	});
});

describe("countOverlayMatches", () => {
	test("counts each overlay independently", () => {
		const counts = countOverlayMatches(model);
		expect(counts).toEqual({ orphans: 2, deadEnds: 2, broken: 1 });
	});
});
