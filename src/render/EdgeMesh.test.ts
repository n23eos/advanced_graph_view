import { Buffer, MeshGeometry, Texture } from "pixi.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createEdgePathView, EdgeMesh, type EdgePathView } from "./EdgeMesh";
import { Camera3D } from "./projection";

function positionBuffer(mesh: EdgeMesh): Float32Array {
	return mesh.mesh.geometry.getBuffer("aPosition").data as Float32Array;
}

function copyPath(view: EdgePathView): Float32Array {
	const copy = new Float32Array(view.pointCount * 2);
	for (let point = 0; point < view.pointCount; point++) {
		const storedPoint = view.reversed ? view.pointCount - 1 - point : point;
		copy[point * 2] = view.points[view.offset + storedPoint * 2];
		copy[point * 2 + 1] = view.points[view.offset + storedPoint * 2 + 1];
	}
	return copy;
}

function readPath(mesh: EdgeMesh, edgeIndex: number): { view: EdgePathView; points: Float32Array } {
	const view = createEdgePathView();
	expect(mesh.getEdgePath(edgeIndex, view)).toBe(true);
	return { view, points: copyPath(view) };
}

function expectRenderedCenterline(mesh: EdgeMesh, edgeIndex: number): void {
	const { view, points } = readPath(mesh, edgeIndex);
	const vertices = positionBuffer(mesh);
	const segmentCount = view.pointCount - 1;
	for (let segment = 0; segment < segmentCount; segment++) {
		const vertex = (edgeIndex * view.pointCount + segment) * 4;
		expect((vertices[vertex] + vertices[vertex + 2]) / 2).toBeCloseTo(points[segment * 2]);
		expect((vertices[vertex + 1] + vertices[vertex + 3]) / 2).toBeCloseTo(points[segment * 2 + 1]);
		expect((vertices[vertex + 4] + vertices[vertex + 6]) / 2).toBeCloseTo(points[segment * 2 + 2]);
		expect((vertices[vertex + 5] + vertices[vertex + 7]) / 2).toBeCloseTo(points[segment * 2 + 3]);
	}
}

describe("EdgeMesh paths", () => {
	test("keeps the original one-quad fast path when curvature is zero", () => {
		const mesh = new EdgeMesh(new Uint32Array([0, 1]), 0xffffff, 1, {
			curvature: 0,
			segments: 6,
			nodeKeys: ["a.md", "b.md"],
		});

		mesh.updatePositions(new Float32Array([10, 20, 110, 20]));

		expect(positionBuffer(mesh)).toHaveLength(8);
		const { view, points } = readPath(mesh, 0);
		expect(view).toMatchObject({
			source: 0,
			target: 1,
			pointCount: 2,
			reversed: false,
		});
		expect(Array.from(points)).toEqual([10, 20, 110, 20]);
		expectRenderedCenterline(mesh, 0);
	});

	test.each([3, 6] as const)("batches a quadratic edge with %i segments", (segments) => {
		const mesh = new EdgeMesh(new Uint32Array([0, 1]), 0xffffff, 1, {
			curvature: 0.25,
			segments,
			nodeKeys: ["a.md", "b.md"],
		});

		mesh.updatePositions(new Float32Array([0, 0, 100, 0]));

		const view = createEdgePathView();
		expect(mesh.findEdgePathByKeys("a.md", "b.md", view)).toBe(true);
		const points = copyPath(view);
		expect(positionBuffer(mesh)).toHaveLength((segments + 1) * 4);
		expect(view.pointCount).toBe(segments + 1);
		expect(points).toHaveLength((segments + 1) * 2);
		expect(points[0]).toBeCloseTo(0);
		expect(points[1]).toBeCloseTo(0);
		expect(points.at(-2)).toBeCloseTo(100);
		expect(points.at(-1)).toBeCloseTo(0);
		expect(Math.max(...points.filter((_, index) => index % 2 === 1))).toBeGreaterThan(0);
		expectRenderedCenterline(mesh, 0);
	});

	test("keeps triangle indices inside each curve when adjacent segments share vertices", () => {
		const mesh = new EdgeMesh(new Uint32Array([0, 1, 1, 2]), 0xffffff, 1, {
			curvature: 0.2, segments: 3,
		});
		const indices = Array.from(mesh.mesh.geometry.indexBuffer.data as Uint32Array);
		for (let edge = 0; edge < 2; edge++) {
			for (let segment = 0; segment < 3; segment++) {
				const v = edge * 8 + segment * 2;
				const offset = (edge * 3 + segment) * 6;
				expect(indices.slice(offset, offset + 6)).toEqual([v, v + 1, v + 2, v + 2, v + 1, v + 3]);
			}
		}
	});

	test("handles a spatial graph containing only isolated nodes", () => {
		const mesh = new EdgeMesh(new Uint32Array(), 0xffffff, 1, { curvature: 0.2 });
		mesh.updatePositions(new Float32Array(2), new Float32Array([1]), {
			positions3d: new Float32Array(3), projector: new Camera3D(),
		});
		expect(positionBuffer(mesh)).toHaveLength(0);
	});

	test("separates reciprocal links and preserves paths across numeric id changes", () => {
		const first = new EdgeMesh(new Uint32Array([0, 1, 1, 0]), 0xffffff, 1, {
			curvature: 0.3,
			segments: 6,
			nodeKeys: ["a.md", "b.md"],
		});
		first.updatePositions(new Float32Array([0, 0, 100, 0]));

		const view = createEdgePathView();
		expect(first.findEdgePathByKeys("a.md", "b.md", view)).toBe(true);
		const forward = copyPath(view);
		expect(first.findEdgePathByKeys("b.md", "a.md", view)).toBe(true);
		const reciprocal = copyPath(view);
		expect(forward[7]).toBeGreaterThan(0);
		expect(reciprocal[7]).toBeLessThan(0);

		const reordered = new EdgeMesh(new Uint32Array([1, 0, 0, 1]), 0xffffff, 1, {
			curvature: 0.3,
			segments: 6,
			nodeKeys: ["b.md", "a.md"],
		});
		reordered.updatePositions(new Float32Array([100, 0, 0, 0]));

		expect(reordered.findEdgePathByKeys("a.md", "b.md", view)).toBe(true);
		expect(Array.from(copyPath(view))).toEqual(Array.from(forward));
		expect(reordered.findEdgePathByKeys("b.md", "a.md", view)).toBe(true);
		expect(Array.from(copyPath(view))).toEqual(Array.from(reciprocal));
	});

	test("uses a reversed fallback for an undirected path but not for a reciprocal edge", () => {
		const mesh = new EdgeMesh(new Uint32Array([0, 1]), 0xffffff, 1, {
			curvature: 0.3,
			segments: 3,
			nodeKeys: ["a.md", "b.md"],
		});
		mesh.updatePositions(new Float32Array([0, 0, 100, 0]));

		const reversed = createEdgePathView();
		expect(mesh.findEdgePath(1, 0, reversed)).toBe(true);
		expect(reversed.reversed).toBe(true);
		expect(reversed.source).toBe(1);
		expect(reversed.target).toBe(0);
		expect(Array.from(copyPath(reversed).slice(0, 2))).toEqual([100, 0]);
		expect(mesh.findEdgePath(1, 0, reversed, false)).toBe(false);
	});

	test("updates the shared path and tangent when an endpoint moves", () => {
		const mesh = new EdgeMesh(new Uint32Array([0, 1]), 0xffffff, 1, {
			curvature: 0.3,
			segments: 3,
			nodeKeys: ["a.md", "b.md"],
		});
		mesh.updatePositions(new Float32Array([0, 0, 100, 0]));
		const before = readPath(mesh, 0).points;

		mesh.updatePositions(new Float32Array([20, 10, 80, 70]));
		const after = readPath(mesh, 0).points;

		expect(Array.from(after)).not.toEqual(Array.from(before));
		expect(Array.from(after.slice(0, 2))).toEqual([20, 10]);
		expect(Array.from(after.slice(-2))).toEqual([80, 70]);
		expect(after.at(-2)! - after.at(-4)!).not.toBe(0);
		expect(after.at(-1)! - after.at(-3)!).not.toBe(0);
		expectRenderedCenterline(mesh, 0);
	});

	test("projects the world-space curve and z override through the same 3D camera", () => {
		const camera = new Camera3D();
		camera.yaw = 0.35;
		camera.pitch = -0.2;
		const xyz = new Float32Array([-80, 10, 120, 110, 60, -90]);
		const zOverride = new Float32Array([40, 260]);
		const projected = new Float32Array(4);
		const depth = new Float32Array(2);
		camera.project(xyz, projected, depth, zOverride);
		const mesh = new EdgeMesh(new Uint32Array([0, 1]), 0xffffff, 1, {
			curvature: 0.3,
			segments: 6,
			nodeKeys: ["a.md", "b.md"],
		});

		mesh.updatePositions(projected, depth, {
			positions3d: xyz,
			projector: camera,
			zOverride,
		});

		const path = readPath(mesh, 0).points;
		expect(Array.from(path.slice(0, 2))).toEqual(Array.from(projected.slice(0, 2)));
		expect(Array.from(path.slice(-2))).toEqual(Array.from(projected.slice(2)));
		expectRenderedCenterline(mesh, 0);
	});

	test("bounds the reusable 3D projection scratch by chunking large edge batches", () => {
		const edgePairs = new Uint32Array(600 * 2);
		for (let edge = 0; edge < 600; edge++) {
			edgePairs[edge * 2] = 0;
			edgePairs[edge * 2 + 1] = 1;
		}
		let calls = 0;
		let largestPointCount = 0;
		const projector = {
			project(xyz: Float32Array, out: Float32Array, depth: Float32Array) {
				calls++;
				largestPointCount = Math.max(largestPointCount, depth.length);
				for (let point = 0; point < depth.length; point++) {
					out[point * 2] = xyz[point * 3];
					out[point * 2 + 1] = xyz[point * 3 + 1];
					depth[point] = 1;
				}
			},
		};
		const mesh = new EdgeMesh(edgePairs, 0xffffff, 1, { curvature: 0.3, segments: 6 });

		mesh.updatePositions(new Float32Array([0, 0, 100, 0]), new Float32Array([1, 1]), {
			positions3d: new Float32Array([0, 0, 0, 100, 0, 0]),
			projector,
		});

		expect(calls).toBe(2);
		expect(largestPointCount).toBe(256 * 7);
	});

	test.each(["mask", "near-plane"] as const)(
		"collapses instead of drawing to the center for a hidden endpoint: %s",
		(kind) => {
			const mesh = new EdgeMesh(new Uint32Array([0, 1]), 0xffffff, 1, {
				curvature: 0.3,
				segments: 6,
				nodeKeys: ["a.md", "b.md"],
			});
			if (kind === "mask") mesh.setHiddenNodes(new Uint8Array([0, 1]));

			if (kind === "near-plane") {
				const camera = new Camera3D();
				const xyz = new Float32Array([120, 80, 0, 100, 40, -880]);
				const projected = new Float32Array(4);
				const depth = new Float32Array(2);
				camera.project(xyz, projected, depth);
				mesh.updatePositions(projected, depth, { positions3d: xyz, projector: camera });
			} else {
				mesh.updatePositions(new Float32Array([120, 80, 40, 10]));
			}

			expect(mesh.getEdgePath(0, createEdgePathView())).toBe(false);
			expect(Array.from(positionBuffer(mesh))).toEqual(new Array(28).fill(0));
		}
	);
});

describe("EdgeMesh teardown", () => {
	afterEach(() => vi.restoreAllMocks());

	test("destroys its buffers once without destroying the shared white texture", () => {
		const textureDestroy = vi.spyOn(Texture.WHITE, "destroy");
		const geometryDestroy = vi.spyOn(MeshGeometry.prototype, "destroy");
		const bufferDestroy = vi.spyOn(Buffer.prototype, "destroy");
		const edges = new EdgeMesh(new Uint32Array([0, 1]), 0xffffff, 1);

		edges.destroy();
		edges.destroy();

		expect(textureDestroy).not.toHaveBeenCalled();
		expect(geometryDestroy).toHaveBeenCalledOnce();
		expect(bufferDestroy).toHaveBeenCalledTimes(3);
	});
});
