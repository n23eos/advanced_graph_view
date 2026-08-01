/**
 * Baseline for the pointer-picking hot path.
 *
 * `pickNodeAt` runs on every pointermove, so its cost is paid tens of times a
 * second while the user is doing nothing but moving the mouse. Step 4 of the
 * plan replaces the linear scan with a grid; these numbers are what it has to beat.
 */
import { bench, describe } from "vitest";
import { pickNodeAt } from "../render/hitTest";
import { makeSyntheticGraph } from "./synthGraph";

const SIZES = [3_000, 10_000];

/** A handful of pointer positions so one lucky early hit can't flatter the result. */
const POINTERS = [
	{ x: 0, y: 0 },
	{ x: 640, y: -320 },
	{ x: -900, y: 480 },
	{ x: 1150, y: 1150 },
];

for (const size of SIZES) {
	describe(`pickNodeAt · ${size} nodes`, () => {
		const screen = makeSyntheticGraph(size).projectToScreen();

		bench("all nodes visible", () => {
			for (const pointer of POINTERS) {
				pickNodeAt({
					positions: screen.positions,
					radii: screen.radii,
					pointerX: pointer.x,
					pointerY: pointer.y,
					hitRadius: 12,
				});
			}
		});

		// Filtering is common in practice and must not become the slow path:
		// hidden nodes are skipped, but the scan still visits them.
		const hiddenMask = new Uint8Array(size);
		for (let i = 0; i < size; i += 2) hiddenMask[i] = 1;

		bench("half the nodes filtered out", () => {
			for (const pointer of POINTERS) {
				pickNodeAt({
					positions: screen.positions,
					radii: screen.radii,
					pointerX: pointer.x,
					pointerY: pointer.y,
					hitRadius: 12,
					hiddenMask,
				});
			}
		});
	});
}
