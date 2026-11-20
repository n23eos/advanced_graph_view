import { Mesh, MeshGeometry, Texture, type Buffer } from "pixi.js";

import { createEdgeTexture, edgeColor, writeEdgeUVs } from "./edgeAppearance";

export interface EdgeMeshOptions {
	/** Control-point offset as a fraction of endpoint distance. Zero is straight. */
	curvature?: number;
	/** Curved-edge detail. Straight edges always use one segment. */
	segments?: 3 | 6;
	/** Stable model identity, normally GraphNode.path in current numeric-id order. */
	nodeKeys?: readonly string[];
}

export interface EdgeProjector {
	project(
		xyz: Float32Array,
		out2d: Float32Array,
		depthScale: Float32Array,
		zOverride?: Float32Array | null
	): void;
}

export interface EdgeSpatialProjection {
	positions3d: Float32Array;
	projector: EdgeProjector;
	zOverride?: Float32Array | null;
}

/**
 * Allocation-free view over EdgeMesh's packed centerline points.
 * The caller owns this object and may reuse it for every edge.
 */
export interface EdgePathView {
	/**
	 * Curved points remain valid until updatePositions. The straight-mode
	 * four-float scratch remains valid until the next path lookup or update.
	 */
	points: Float32Array;
	/** Float offset of the first stored xy pair. */
	offset: number;
	pointCount: number;
	/** Underlying directed edge, even when the requested view is reversed. */
	edgeIndex: number;
	/** Requested traversal direction. */
	source: number;
	target: number;
	reversed: boolean;
}

export function createEdgePathView(): EdgePathView {
	return {
		points: new Float32Array(0),
		offset: 0,
		pointCount: 0,
		edgeIndex: -1,
		source: -1,
		target: -1,
		reversed: false,
	};
}

const SPATIAL_CHUNK_EDGES = 256;

function setPair(
	index: Map<number, Map<number, number>>,
	source: number,
	target: number,
	edgeIndex: number
): void {
	let targets = index.get(source);
	if (!targets) {
		targets = new Map();
		index.set(source, targets);
	}
	if (!targets.has(target)) targets.set(target, edgeIndex);
}

function setKeyPair(
	index: Map<string, Map<string, number>>,
	source: string,
	target: string,
	edgeIndex: number
): void {
	let targets = index.get(source);
	if (!targets) {
		targets = new Map();
		index.set(source, targets);
	}
	if (!targets.has(target)) targets.set(target, edgeIndex);
}

function quadratic(start: number, control: number, end: number, t: number): number {
	const inverse = 1 - t;
	return inverse * inverse * start + 2 * inverse * t * control + t * t * end;
}

/**
 * All edges as one GPU mesh. Straight edges retain the original one-quad
 * representation. Curved edges use a fixed number of adjacent quads.
 */
export class EdgeMesh {
	readonly mesh: Mesh;
	private readonly vertices: Float32Array;
	private readonly uvs: Float32Array;
	private edgeTexture: Texture | null = null;
	private readonly positionBuffer: Buffer;
	private readonly geometry: MeshGeometry;
	private readonly edgePairs: Uint32Array;
	private readonly curvature: number;
	private readonly segmentCount: number;
	private readonly pointsPerEdge: number;
	private readonly pathPoints: Float32Array;
	private readonly pathDepths: Float32Array | null;
	private readonly pathVisible: Uint8Array;
	private readonly edgeByPair = new Map<number, Map<number, number>>();
	private readonly edgeByKeyPair = new Map<string, Map<string, number>>();
	private readonly spatialWorldScratch: Float32Array | null;
	private readonly spatialProjectedScratch: Float32Array | null;
	private readonly spatialDepthScratch: Float32Array | null;
	private destroyed = false;
	private width = 1;
	private hiddenNodes: Uint8Array | null = null;
	private lastPositions: Float32Array | null = null;

	constructor(
		edgePairs: Uint32Array,
		color: number,
		alpha: number,
		options: EdgeMeshOptions = {}
	) {
		this.edgePairs = edgePairs;
		this.curvature = Number.isFinite(options.curvature) ? (options.curvature ?? 0) : 0;
		this.segmentCount = this.curvature === 0 ? 1 : (options.segments ?? 6);
		this.pointsPerEdge = this.segmentCount + 1;
		const edgeCount = edgePairs.length / 2;
		this.vertices = new Float32Array(edgeCount * this.segmentCount * 8);
		// Straight mode keeps only one reusable path scratch. Its hot update loop
		// remains one pass and does not allocate a second O(E) centerline buffer.
		this.pathPoints = new Float32Array(
			this.segmentCount === 1 ? 4 : edgeCount * this.pointsPerEdge * 2
		);
		this.pathDepths = this.segmentCount === 1
			? null
			: new Float32Array(edgeCount * this.pointsPerEdge);
		this.pathVisible = new Uint8Array(edgeCount);

		const scratchPointCount = this.segmentCount === 1
			? 0
			: Math.min(edgeCount, SPATIAL_CHUNK_EDGES) * this.pointsPerEdge;
		this.spatialWorldScratch = scratchPointCount > 0
			? new Float32Array(scratchPointCount * 3)
			: null;
		this.spatialProjectedScratch = scratchPointCount > 0
			? new Float32Array(scratchPointCount * 2)
			: null;
		this.spatialDepthScratch = scratchPointCount > 0
			? new Float32Array(scratchPointCount)
			: null;

		const indices = new Uint32Array(edgeCount * this.segmentCount * 6);
		for (let edge = 0; edge < edgeCount; edge++) {
			const source = edgePairs[edge * 2];
			const target = edgePairs[edge * 2 + 1];
			setPair(this.edgeByPair, source, target, edge);
			const sourceKey = options.nodeKeys?.[source];
			const targetKey = options.nodeKeys?.[target];
			if (sourceKey !== undefined && targetKey !== undefined) {
				setKeyPair(this.edgeByKeyPair, sourceKey, targetKey, edge);
			}
			for (let segment = 0; segment < this.segmentCount; segment++) {
				const geometrySegment = edge * this.segmentCount + segment;
				const vertex = geometrySegment * 4;
				const index = geometrySegment * 6;
				indices[index] = vertex;
				indices[index + 1] = vertex + 1;
				indices[index + 2] = vertex + 2;
				indices[index + 3] = vertex + 2;
				indices[index + 4] = vertex + 1;
				indices[index + 5] = vertex + 3;
			}
		}

		this.uvs = new Float32Array(this.vertices.length);
		this.geometry = new MeshGeometry({
			positions: this.vertices,
			uvs: this.uvs,
			indices,
			topology: "triangle-list",
		});
		this.positionBuffer = this.geometry.getBuffer("aPosition");
		this.mesh = new Mesh({ geometry: this.geometry, texture: Texture.WHITE });
		this.mesh.tint = color;
		this.mesh.alpha = alpha;
	}

	setAlpha(alpha: number): void {
		this.mesh.alpha = alpha;
	}

	setPalette(nodeTints: Int32Array | null, accent: number, foreground: number): void {
		if (!this.edgeTexture) {
			this.edgeTexture = createEdgeTexture();
			this.mesh.texture = this.edgeTexture;
			this.mesh.tint = 0xffffff;
		}
		for (let edge = 0; edge < this.pathVisible.length; edge++) {
			const source = nodeTints?.[this.edgePairs[edge * 2]] ?? -1;
			const target = nodeTints?.[this.edgePairs[edge * 2 + 1]] ?? -1;
			writeEdgeUVs(this.uvs, edge * this.segmentCount * 8, this.segmentCount, edgeColor(source, target, accent, foreground));
		}
		this.geometry.getBuffer("aUV").update();
	}

	setVisible(visible: boolean): void {
		this.mesh.visible = visible;
	}

	/** World-units line width for the next geometry update. */
	setWidth(width: number): void {
		this.width = width;
	}

	setHiddenNodes(mask: Uint8Array | null): void {
		this.hiddenNodes = mask;
	}

	/**
	 * Rebuild packed screen paths, then rewrite the shared vertex buffer.
	 * spatial is required only for 3D curves. It keeps the curve in graph
	 * space and projects it with the same camera and optional depth override.
	 */
	updatePositions(
		nodePositions: Float32Array,
		depthScales?: Float32Array | null,
		spatial?: EdgeSpatialProjection | null
	): void {
		this.lastPositions = nodePositions;
		if (this.segmentCount === 1) {
			this.updateStraightPathsAndVertices(nodePositions, depthScales ?? null);
		} else if (spatial) {
			this.updateSpatialPaths(nodePositions, depthScales ?? null, spatial);
			this.updateVertices();
		} else {
			this.updateProjectedPaths(nodePositions, depthScales ?? null);
			this.updateVertices();
		}
		this.positionBuffer.update();
	}

	/** Read the exact stored direction of an edge without allocating. */
	getEdgePath(edgeIndex: number, out: EdgePathView): boolean {
		if (edgeIndex < 0 || edgeIndex >= this.pathVisible.length || this.pathVisible[edgeIndex] === 0) {
			return false;
		}
		return this.writePathView(
			edgeIndex,
			this.edgePairs[edgeIndex * 2],
			this.edgePairs[edgeIndex * 2 + 1],
			false,
			out
		);
	}

	/**
	 * Find a path in the requested traversal direction. Exact direction wins.
	 * If only the opposite edge exists, the same centerline is viewed in reverse.
	 */
	findEdgePath(
		source: number,
		target: number,
		out: EdgePathView,
		allowReverse = true
	): boolean {
		const exact = this.edgeByPair.get(source)?.get(target);
		if (exact !== undefined && this.pathVisible[exact] === 1) {
			return this.writePathView(exact, source, target, false, out);
		}
		if (!allowReverse) return false;
		const reverse = this.edgeByPair.get(target)?.get(source);
		if (reverse === undefined || this.pathVisible[reverse] === 0) return false;
		return this.writePathView(reverse, source, target, true, out);
	}

	/** Stable-path counterpart of findEdgePath for model rebuilds with new ids. */
	findEdgePathByKeys(
		sourceKey: string,
		targetKey: string,
		out: EdgePathView,
		allowReverse = true
	): boolean {
		const exact = this.edgeByKeyPair.get(sourceKey)?.get(targetKey);
		if (exact !== undefined && this.pathVisible[exact] === 1) {
			return this.writePathView(
				exact,
				this.edgePairs[exact * 2],
				this.edgePairs[exact * 2 + 1],
				false,
				out
			);
		}
		if (!allowReverse) return false;
		const reverse = this.edgeByKeyPair.get(targetKey)?.get(sourceKey);
		if (reverse === undefined || this.pathVisible[reverse] === 0) return false;
		return this.writePathView(
			reverse,
			this.edgePairs[reverse * 2 + 1],
			this.edgePairs[reverse * 2],
			true,
			out
		);
	}

	private writePathView(
		edgeIndex: number,
		source: number,
		target: number,
		reversed: boolean,
		out: EdgePathView
	): boolean {
		out.points = this.pathPoints;
		if (this.segmentCount === 1) {
			const storedSource = this.edgePairs[edgeIndex * 2];
			const storedTarget = this.edgePairs[edgeIndex * 2 + 1];
			this.pathPoints[0] = this.lastPositions![storedSource * 2];
			this.pathPoints[1] = this.lastPositions![storedSource * 2 + 1];
			this.pathPoints[2] = this.lastPositions![storedTarget * 2];
			this.pathPoints[3] = this.lastPositions![storedTarget * 2 + 1];
			out.offset = 0;
		} else {
			out.offset = edgeIndex * this.pointsPerEdge * 2;
		}
		out.pointCount = this.pointsPerEdge;
		out.edgeIndex = edgeIndex;
		out.source = source;
		out.target = target;
		out.reversed = reversed;
		return true;
	}

	private edgeIsVisible(source: number, target: number, depthScales: Float32Array | null): boolean {
		if (this.hiddenNodes?.[source] === 1 || this.hiddenNodes?.[target] === 1) return false;
		if (depthScales && (depthScales[source] <= 0 || depthScales[target] <= 0)) return false;
		return true;
	}

	/** Preserve perspective without losing distant strands below a pixel. */
	private strokeDepth(depth: number): number {
		return this.edgeTexture ? 0.2 + 0.8 * Math.min(depth, 2.4) : depth;
	}

	private updateStraightPathsAndVertices(
		nodePositions: Float32Array,
		depthScales: Float32Array | null
	): void {
		for (let edge = 0; edge < this.pathVisible.length; edge++) {
			const source = this.edgePairs[edge * 2];
			const target = this.edgePairs[edge * 2 + 1];
			const x1 = nodePositions[source * 2];
			const y1 = nodePositions[source * 2 + 1];
			const x2 = nodePositions[target * 2];
			const y2 = nodePositions[target * 2 + 1];
			const visible = this.edgeIsVisible(source, target, depthScales) &&
				Number.isFinite(x1) && Number.isFinite(y1) &&
				Number.isFinite(x2) && Number.isFinite(y2);
			this.pathVisible[edge] = visible ? 1 : 0;
			const vertex = edge * 8;
			if (!visible) {
				this.vertices.fill(0, vertex, vertex + 8);
				continue;
			}
			const dx = x2 - x1;
			const dy = y2 - y1;
			const length = Math.hypot(dx, dy) || 1;
			const half = depthScales
				? this.width * this.strokeDepth((depthScales[source] + depthScales[target]) * 0.5) * 0.5
				: this.width / 2;
			const px = (-dy / length) * half;
			const py = (dx / length) * half;
			this.vertices[vertex] = x1 + px;
			this.vertices[vertex + 1] = y1 + py;
			this.vertices[vertex + 2] = x1 - px;
			this.vertices[vertex + 3] = y1 - py;
			this.vertices[vertex + 4] = x2 + px;
			this.vertices[vertex + 5] = y2 + py;
			this.vertices[vertex + 6] = x2 - px;
			this.vertices[vertex + 7] = y2 - py;
		}
	}

	private updateProjectedPaths(
		nodePositions: Float32Array,
		depthScales: Float32Array | null
	): void {
		for (let edge = 0; edge < this.pathVisible.length; edge++) {
			const source = this.edgePairs[edge * 2];
			const target = this.edgePairs[edge * 2 + 1];
			const x1 = nodePositions[source * 2];
			const y1 = nodePositions[source * 2 + 1];
			const x2 = nodePositions[target * 2];
			const y2 = nodePositions[target * 2 + 1];
			const dx = x2 - x1;
			const dy = y2 - y1;
			const length = Math.hypot(dx, dy);
			const controlX = (x1 + x2) * 0.5 - (dy / (length || 1)) * length * this.curvature;
			const controlY = (y1 + y2) * 0.5 + (dx / (length || 1)) * length * this.curvature;
			const pointOffset = edge * this.pointsPerEdge * 2;
			const depthOffset = edge * this.pointsPerEdge;
			let visible = this.edgeIsVisible(source, target, depthScales) &&
				Number.isFinite(x1) && Number.isFinite(y1) &&
				Number.isFinite(x2) && Number.isFinite(y2);
			for (let point = 0; point < this.pointsPerEdge; point++) {
				const t = point / this.segmentCount;
				this.pathPoints[pointOffset + point * 2] = quadratic(x1, controlX, x2, t);
				this.pathPoints[pointOffset + point * 2 + 1] = quadratic(y1, controlY, y2, t);
				if (this.pathDepths) {
					const sourceDepth = depthScales?.[source] ?? 1;
					const targetDepth = depthScales?.[target] ?? 1;
					const depth = sourceDepth + (targetDepth - sourceDepth) * t;
					this.pathDepths[depthOffset + point] = depth;
					if (depth <= 0) visible = false;
				}
			}
			this.pathVisible[edge] = visible ? 1 : 0;
		}
	}

	private updateSpatialPaths(
		nodePositions: Float32Array,
		depthScales: Float32Array | null,
		spatial: EdgeSpatialProjection
	): void {
		const world = this.spatialWorldScratch!;
		const projected = this.spatialProjectedScratch!;
		const projectedDepth = this.spatialDepthScratch!;
		const chunkEdgeCount = world.length / 3 / this.pointsPerEdge;
		for (let firstEdge = 0; firstEdge < this.pathVisible.length; firstEdge += chunkEdgeCount) {
			const count = Math.min(chunkEdgeCount, this.pathVisible.length - firstEdge);
			for (let localEdge = 0; localEdge < count; localEdge++) {
				const edge = firstEdge + localEdge;
				const source = this.edgePairs[edge * 2];
				const target = this.edgePairs[edge * 2 + 1];
				this.writeSpatialCurve(localEdge, source, target, spatial);
			}
			spatial.projector.project(world, projected, projectedDepth);
			for (let localEdge = 0; localEdge < count; localEdge++) {
				const edge = firstEdge + localEdge;
				const source = this.edgePairs[edge * 2];
				const target = this.edgePairs[edge * 2 + 1];
				const sourceOffset = localEdge * this.pointsPerEdge;
				const targetOffset = edge * this.pointsPerEdge;
				let visible = this.edgeIsVisible(source, target, depthScales);
				for (let point = 0; point < this.pointsPerEdge; point++) {
					const sourcePoint = sourceOffset + point;
					const targetPoint = targetOffset + point;
					const x = projected[sourcePoint * 2];
					const y = projected[sourcePoint * 2 + 1];
					const depth = projectedDepth[sourcePoint];
					this.pathPoints[targetPoint * 2] = x;
					this.pathPoints[targetPoint * 2 + 1] = y;
					this.pathDepths![targetPoint] = depth;
					if (depth <= 0 || !Number.isFinite(depth) || !Number.isFinite(x) || !Number.isFinite(y)) {
						visible = false;
					}
				}
				// Use the already projected node endpoints bit-for-bit.
				this.pathPoints[targetOffset * 2] = nodePositions[source * 2];
				this.pathPoints[targetOffset * 2 + 1] = nodePositions[source * 2 + 1];
				const end = targetOffset + this.pointsPerEdge - 1;
				this.pathPoints[end * 2] = nodePositions[target * 2];
				this.pathPoints[end * 2 + 1] = nodePositions[target * 2 + 1];
				if (depthScales) {
					this.pathDepths![targetOffset] = depthScales[source];
					this.pathDepths![end] = depthScales[target];
				}
				this.pathVisible[edge] = visible ? 1 : 0;
			}
		}
	}

	private writeSpatialCurve(
		localEdge: number,
		source: number,
		target: number,
		spatial: EdgeSpatialProjection
	): void {
		const xyz = spatial.positions3d;
		const x1 = xyz[source * 3];
		const y1 = xyz[source * 3 + 1];
		const z1 = spatial.zOverride?.[source] ?? xyz[source * 3 + 2];
		const x2 = xyz[target * 3];
		const y2 = xyz[target * 3 + 1];
		const z2 = spatial.zOverride?.[target] ?? xyz[target * 3 + 2];
		const dx = x2 - x1;
		const dy = y2 - y1;
		const dz = z2 - z1;
		const planarLength = Math.sqrt(dx * dx + dy * dy);
		const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
		let perpendicularX = -dy;
		let perpendicularY = dx;
		let perpendicularZ = 0;
		let perpendicularLength = planarLength;
		if (perpendicularLength < 1e-6) {
			perpendicularX = dz;
			perpendicularY = 0;
			perpendicularZ = -dx;
			perpendicularLength = Math.sqrt(perpendicularX * perpendicularX + perpendicularZ * perpendicularZ);
		}
		const offset = length * this.curvature / (perpendicularLength || 1);
		const controlX = (x1 + x2) * 0.5 + perpendicularX * offset;
		const controlY = (y1 + y2) * 0.5 + perpendicularY * offset;
		const controlZ = (z1 + z2) * 0.5 + perpendicularZ * offset;
		const pointOffset = localEdge * this.pointsPerEdge;
		for (let point = 0; point < this.pointsPerEdge; point++) {
			const t = point / this.segmentCount;
			const offset3 = (pointOffset + point) * 3;
			this.spatialWorldScratch![offset3] = quadratic(x1, controlX, x2, t);
			this.spatialWorldScratch![offset3 + 1] = quadratic(y1, controlY, y2, t);
			this.spatialWorldScratch![offset3 + 2] = quadratic(z1, controlZ, z2, t);
		}
	}

	private updateVertices(): void {
		for (let edge = 0; edge < this.pathVisible.length; edge++) {
			const edgeVertex = edge * this.segmentCount * 8;
			if (this.pathVisible[edge] === 0) {
				this.vertices.fill(0, edgeVertex, edgeVertex + this.segmentCount * 8);
				continue;
			}
			const pointOffset = edge * this.pointsPerEdge;
			let endPx = 0;
			let endPy = 0;
			for (let segment = 0; segment < this.segmentCount; segment++) {
				const point = pointOffset + segment;
				const x1 = this.pathPoints[point * 2];
				const y1 = this.pathPoints[point * 2 + 1];
				const x2 = this.pathPoints[point * 2 + 2];
				const y2 = this.pathPoints[point * 2 + 3];
				const following = segment === this.segmentCount - 1 ? point + 1 : point + 2;
				const endDx = this.pathPoints[following * 2] - this.pathPoints[point * 2];
				const endDy = this.pathPoints[following * 2 + 1] - this.pathPoints[point * 2 + 1];
				if (segment === 0) {
					const dx = x2 - x1;
					const dy = y2 - y1;
					const length = Math.sqrt(dx * dx + dy * dy) || 1;
					const offset = this.width * this.strokeDepth(this.pathDepths![point]) * 0.5 / length;
					endPx = -dy * offset;
					endPy = dx * offset;
				}
				const startPx = endPx;
				const startPy = endPy;
				const endLength = Math.sqrt(endDx * endDx + endDy * endDy) || 1;
				const endOffset = this.width * this.strokeDepth(this.pathDepths![point + 1]) * 0.5 / endLength;
				endPx = -endDy * endOffset;
				endPy = endDx * endOffset;
				const vertex = edgeVertex + segment * 8;
				this.vertices[vertex] = x1 + startPx;
				this.vertices[vertex + 1] = y1 + startPy;
				this.vertices[vertex + 2] = x1 - startPx;
				this.vertices[vertex + 3] = y1 - startPy;
				this.vertices[vertex + 4] = x2 + endPx;
				this.vertices[vertex + 5] = y2 + endPy;
				this.vertices[vertex + 6] = x2 - endPx;
				this.vertices[vertex + 7] = y2 - endPy;
			}
		}
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		const buffers = [...this.geometry.buffers];
		const indexBuffer = this.geometry.indexBuffer;
		// Texture.WHITE and the default shader belong to Pixi, not this mesh.
		this.mesh.destroy({ texture: false, textureSource: false });
		this.edgeTexture?.destroy(true);
		// Pixi's Geometry.destroy(true) destroys the index buffer twice.
		this.geometry.destroy(false);
		for (const buffer of buffers) {
			if (buffer !== indexBuffer) buffer.destroy();
		}
	}
}
