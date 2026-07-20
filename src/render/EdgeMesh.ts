import { Mesh, MeshGeometry, Texture, type Buffer } from "pixi.js";

/**
 * All edges as one GPU mesh: each edge is a quad (2 triangles) so line
 * width is adjustable — gl.LINES caps width at 1px on most platforms.
 * Position updates rewrite the vertex buffer in place; no geometry rebuild.
 */
export class EdgeMesh {
	readonly mesh: Mesh;
	private readonly vertices: Float32Array;
	private readonly positionBuffer: Buffer;
	/** Flat [source0, target0, source1, target1, ...] node id pairs. */
	private readonly edgePairs: Uint32Array;
	private width = 1;
	/** 1 = node hidden; its edges collapse to zero-area (invisible). */
	private hiddenNodes: Uint8Array | null = null;
	private lastPositions: Float32Array | null = null;
	private lastDepthScales: Float32Array | null = null;

	constructor(edgePairs: Uint32Array, color: number, alpha: number) {
		this.edgePairs = edgePairs;
		const edgeCount = edgePairs.length / 2;
		this.vertices = new Float32Array(edgeCount * 8); // 4 verts × (x,y)

		const indices = new Uint32Array(edgeCount * 6);
		for (let e = 0; e < edgeCount; e++) {
			const v = e * 4;
			const i = e * 6;
			indices[i] = v;
			indices[i + 1] = v + 1;
			indices[i + 2] = v + 2;
			indices[i + 3] = v + 2;
			indices[i + 4] = v + 1;
			indices[i + 5] = v + 3;
		}

		const geometry = new MeshGeometry({
			positions: this.vertices,
			uvs: new Float32Array(edgeCount * 8),
			indices,
			topology: "triangle-list",
		});
		this.positionBuffer = geometry.getBuffer("aPosition");

		this.mesh = new Mesh({ geometry, texture: Texture.WHITE });
		this.mesh.tint = color;
		this.mesh.alpha = alpha;
	}

	setAlpha(alpha: number): void {
		this.mesh.alpha = alpha;
	}

	setVisible(visible: boolean): void {
		this.mesh.visible = visible;
	}

	/** World-units line width; re-applies the last known positions. */
	setWidth(width: number): void {
		this.width = width;
		if (this.lastPositions) this.updatePositions(this.lastPositions, this.lastDepthScales);
	}

	setHiddenNodes(mask: Uint8Array | null): void {
		this.hiddenNodes = mask;
	}

	updatePositions(nodePositions: Float32Array, depthScales?: Float32Array | null): void {
		this.lastPositions = nodePositions;
		this.lastDepthScales = depthScales ?? null;
		const pairs = this.edgePairs;
		const vertices = this.vertices;
		const hidden = this.hiddenNodes;
		const baseHalf = this.width / 2;

		for (let e = 0; e < pairs.length / 2; e++) {
			const source = pairs[e * 2];
			const target = pairs[e * 2 + 1];
			const base = e * 8;
			if (hidden !== null && (hidden[source] === 1 || hidden[target] === 1)) {
				vertices.fill(0, base, base + 8);
				continue;
			}
			const x1 = nodePositions[source * 2];
			const y1 = nodePositions[source * 2 + 1];
			const x2 = nodePositions[target * 2];
			const y2 = nodePositions[target * 2 + 1];
			const dx = x2 - x1;
			const dy = y2 - y1;
			const length = Math.hypot(dx, dy) || 1;
			// Perpendicular offset gives the quad its thickness; in 3D the
			// width follows the endpoints' perspective scale so near edges
			// look as thick as their nodes.
			const half = depthScales
				? baseHalf * (depthScales[source] + depthScales[target]) * 0.5
				: baseHalf;
			const px = (-dy / length) * half;
			const py = (dx / length) * half;
			vertices[base] = x1 + px;
			vertices[base + 1] = y1 + py;
			vertices[base + 2] = x1 - px;
			vertices[base + 3] = y1 - py;
			vertices[base + 4] = x2 + px;
			vertices[base + 5] = y2 + py;
			vertices[base + 6] = x2 - px;
			vertices[base + 7] = y2 - py;
		}
		this.positionBuffer.update();
	}

	destroy(): void {
		this.mesh.destroy(true);
	}
}
