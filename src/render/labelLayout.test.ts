import { describe, expect, test } from "vitest";
import { LabelCollisionGrid, type LabelBox } from "./labelCollision";
import {
	placeLabelCandidates,
	selectLabelCandidates,
	type LabelLayoutCandidate,
} from "./labelLayout";

const box = (x: number, y = 0): LabelBox => ({ x, y, width: 40, height: 14 });

function candidate(
	id: string,
	role: LabelLayoutCandidate["role"],
	importance: number,
	overrides: Partial<LabelLayoutCandidate> = {}
): LabelLayoutCandidate {
	return {
		id,
		stableKey: id,
		role,
		importance,
		zoom: 1,
		minZoom: 0,
		wasVisible: false,
		placements: [box(0)],
		...overrides,
	};
}

describe("label candidate selection", () => {
	test("orders pointer, selection, action, search, neighbor, hub, group and normal", () => {
		const candidates = [
			candidate("normal", "normal", 100),
			candidate("folder", "group", 100),
			candidate("hub", "hub", 100),
			candidate("neighbor", "neighbor", 100),
			candidate("search", "search", 100),
			candidate("action", "action", 100),
			candidate("selected", "selected", 100),
			candidate("pointer", "pointer", 0),
		];

		expect(selectLabelCandidates(candidates, { hysteresis: 0, searchResultCount: 8 }).map((item) => item.id))
			.toEqual(["pointer", "selected", "action", "search", "neighbor", "hub", "folder", "normal"]);
	});

	test("keeps up to eight search results explicit and demotes nine to overview order", () => {
		const candidates = [
			candidate("search", "search", 1, { zoom: 0, minZoom: 10 }),
			candidate("hub", "hub", 10),
		];

		expect(selectLabelCandidates(candidates, { hysteresis: 0, searchResultCount: 8 }).map((item) => item.id))
			.toEqual(["search", "hub"]);
		expect(selectLabelCandidates(candidates, { hysteresis: 0, searchResultCount: 9 }).map((item) => item.id))
			.toEqual(["hub"]);
	});

	test("keeps pointer, selection and active actions above the zoom threshold", () => {
		const contextual = [
			candidate("pointer", "pointer", 1, { zoom: 0, minZoom: 10 }),
			candidate("selected", "selected", 1, { zoom: 0, minZoom: 10 }),
			candidate("route", "action", 1, { zoom: 0, minZoom: 10 }),
			candidate("normal", "normal", 1, { zoom: 0, minZoom: 10 }),
		];

		expect(selectLabelCandidates(contextual, { hysteresis: 0 }).map((item) => item.id))
			.toEqual(["pointer", "selected", "route"]);
	});

	test("uses importance and stable keys without mutating the input", () => {
		const candidates = [
			candidate("b", "hub", 4),
			candidate("c", "hub", 8),
			candidate("a", "hub", 4),
		];
		const original = [...candidates];

		const first = selectLabelCandidates(candidates, { hysteresis: 0 });
		const second = selectLabelCandidates(candidates, { hysteresis: 0 });

		expect(first.map((item) => item.id)).toEqual(["c", "a", "b"]);
		expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));
		expect(candidates).toEqual(original);
	});

	test("keeps a visible label through the lower zoom hysteresis band", () => {
		const fading = candidate("old", "normal", 1, {
			zoom: 0.92,
			minZoom: 1,
			wasVisible: true,
		});
		const incoming = candidate("new", "normal", 1, {
			zoom: 0.92,
			minZoom: 1,
			wasVisible: false,
		});

		expect(selectLabelCandidates([fading, incoming], { hysteresis: 0.1 }).map((item) => item.id))
			.toEqual(["old"]);
		expect(selectLabelCandidates([{ ...fading, zoom: 0.89 }], { hysteresis: 0.1 }))
			.toEqual([]);
	});
});

describe("label placement", () => {
	test("lets the pointer displace selection and moves a folder to an alternative", () => {
		const grid = new LabelCollisionGrid(32);
		const candidates = [
			candidate("folder", "group", 20, { placements: [box(0), box(50)] }),
			candidate("selected", "selected", 20, { placements: [box(0)] }),
			candidate("pointer", "pointer", 0, { placements: [box(0)] }),
		];
		const ranked = selectLabelCandidates(candidates, { hysteresis: 0 });

		const placed = placeLabelCandidates(ranked, grid, { budget: 3 });

		expect(placed.map((item) => item.id)).toEqual(["pointer", "folder"]);
		expect(placed[1].placementIndex).toBe(1);
	});

	test("tries the stable previous position before alternatives on neighboring frames", () => {
		const grid = new LabelCollisionGrid(32);
		const label = candidate("note", "hub", 1, {
			placements: [box(0), box(50), box(100)],
			preferredPlacement: 1,
		});

		const first = placeLabelCandidates([label], grid, { budget: 1 });
		const second = placeLabelCandidates([label], grid, { budget: 1 });

		expect(first[0].placementIndex).toBe(1);
		expect(second[0].placementIndex).toBe(1);
		expect(second[0].box).toBe(label.placements[1]);
	});

	test("uses an alternative when a fading label reserves the preferred box", () => {
		const grid = new LabelCollisionGrid(32);
		const label = candidate("folder", "group", 1, {
			placements: [box(0), box(50)],
		});

		const placed = placeLabelCandidates([label], grid, {
			budget: 1,
			reservations: [box(0)],
		});

		expect(placed).toHaveLength(1);
		expect(placed[0].placementIndex).toBe(1);
	});

	test("respects the shared budget for hundreds of neighbors", () => {
		const grid = new LabelCollisionGrid(32);
		const neighbors = Array.from({ length: 601 }, (_, index) =>
			candidate(String(index), "neighbor", 601 - index, { placements: [box(index * 50)] })
		);
		const ranked = selectLabelCandidates(neighbors, { hysteresis: 0 });

		const placed = placeLabelCandidates(ranked, grid, { budget: 120 });

		expect(placed).toHaveLength(120);
		expect(placed[0].id).toBe("0");
		expect(placed.at(-1)?.id).toBe("119");
	});

	test("limits alternative probes per candidate", () => {
		const grid = new LabelCollisionGrid(32);
		const label = candidate("note", "normal", 1, {
			placements: [box(0), box(50), box(100)],
		});

		const placed = placeLabelCandidates([label], grid, {
			budget: 1,
			reservations: [box(0), box(50)],
			maxPlacements: 2,
		});

		expect(placed).toEqual([]);
	});
});
