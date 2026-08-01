/**
 * Baseline for rewriting the edge vertex buffer.
 *
 * Every layout tick rewrites all four vertices of every edge, so this scales
 * with link count rather than note count — the number that actually hurts on a
 * densely linked vault.
 */
import { bench, describe } from "vitest";
import { EdgeMesh } from "../render/EdgeMesh";
import { makeSyntheticGraph } from "./synthGraph";

const SIZES = [3_000, 10_000];

for (const size of SIZES) {
	const graph = makeSyntheticGraph(size);
	const edgeCount = graph.edgePairs.length / 2;
	const screen = graph.projectToScreen();

	describe(`EdgeMesh.updatePositions · ${size} nodes / ${edgeCount} edges`, () => {
		const mesh = new EdgeMesh(graph.edgePairs, 0xffffff, 0.25);

		bench("2D — flat width", () => {
			mesh.updatePositions(screen.positions);
		});

		// 3D scales each edge's width by its endpoints' depth, which adds two
		// array reads and a multiply per edge.
		const depthScales = new Float32Array(size);
		for (let i = 0; i < size; i++) depthScales[i] = 0.5 + (i % 100) / 100;

		bench("3D — per-edge depth width", () => {
			mesh.updatePositions(screen.positions, depthScales);
		});
	});
}
