import {
	Application,
	Container,
	Graphics,
	Sprite,
	Text,
	type Texture,
} from "pixi.js";
import { convexHull, type Point } from "../analysis/hull";
import { pointInPolygon } from "../analysis/geometry";
import type { GraphModel } from "../data/GraphStore";
import { EdgeMesh } from "./EdgeMesh";
import { createNodeTexture, createStarTexture, STAR_SIZE_FACTOR } from "./NodeTexture";
import { Camera3D } from "./projection";
import { Viewport } from "./Viewport";

const BASE_NODE_RADIUS = 4;
const DEGREE_RADIUS_BOOST = 0.35; // radius grows with sqrt(degree)
const MAX_NODE_RADIUS = 16;
const HOVER_RADIUS_PX = 12;
const DEFAULT_LABEL_ZOOM_THRESHOLD = 0.9;
const DEFAULT_LABEL_FONT_SIZE = 11;
const LABEL_COUNT_LIMIT = 150;
const TINY_NODE_CULL_PX = 0.35; // nodes smaller than this on screen are skipped
const EDGE_ALPHA = 0.25;
// Text rasterization is expensive; creating many labels in one frame causes
// visible hitches during panning, so budget creations per frame.
const NEW_LABELS_PER_FRAME = 4;
const DIM_ALPHA = 0.12;
/** Hover emphasis: sprite grows, neighbors stay lit, the rest recedes. */
const HOVER_SIZE_BOOST = 1.9;
/** Search/overlay matches grow a little so they read at a glance. */
const HIGHLIGHT_SIZE_BOOST = 1.45;
const HOVER_NEIGHBOR_ALPHA = 0.9;
const HOVER_REST_ALPHA = 0.25;
const CULL_MIN_INTERVAL_MS = 30;
const MIN_LABEL_SCREEN_PX = 8;
const DOUBLE_CLICK_MS = 350;
const HULL_FILL_ALPHA = 0.1;
const HULL_PADDING = 18;

export interface RendererCallbacks {
	onNodeHover(nodeId: number | null, clientX: number, clientY: number): void;
	onNodeClick(nodeId: number, event: PointerEvent): void;
	onNodeDoubleClick(nodeId: number): void;
	onNodeContextMenu(nodeId: number, event: MouseEvent): void;
	onNodeDragStart(nodeId: number): void;
	onNodeDrag(nodeId: number, worldX: number, worldY: number, worldZ: number): void;
	onNodeDragEnd(nodeId: number): void;
	onLassoSelect(nodeIds: number[], event: PointerEvent): void;
}

/** Pointer must travel this many pixels before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

interface ThemeColors {
	node: number;
	nodeSelected: number;
	edge: number;
	label: number;
}

function cssColorToNumber(value: string): number {
	const probe = document.createElement("div");
	probe.style.color = value;
	document.body.appendChild(probe);
	const rgb = getComputedStyle(probe).color.match(/\d+/g);
	probe.remove();
	if (!rgb) return 0x888888;
	return (Number(rgb[0]) << 16) | (Number(rgb[1]) << 8) | Number(rgb[2]);
}

/** Push hull vertices outward from the centroid so bubbles breathe. */
function padHull(hull: Point[], padding: number): Point[] {
	if (hull.length < 3) return hull;
	let cx = 0, cy = 0;
	for (const p of hull) { cx += p.x; cy += p.y; }
	cx /= hull.length;
	cy /= hull.length;
	return hull.map((p) => {
		const dx = p.x - cx;
		const dy = p.y - cy;
		const length = Math.hypot(dx, dy) || 1;
		return { x: p.x + (dx / length) * padding, y: p.y + (dy / length) * padding };
	});
}

function drawArrowHead(
	g: Graphics,
	x1: number, y1: number, x2: number, y2: number,
	color: number, alpha: number
): void {
	const angle = Math.atan2(y2 - y1, x2 - x1);
	const size = 6;
	// Head sits at 65% of the segment so it stays visible outside node circles.
	const hx = x1 + (x2 - x1) * 0.65;
	const hy = y1 + (y2 - y1) * 0.65;
	g.moveTo(hx, hy);
	g.lineTo(hx - size * Math.cos(angle - 0.4), hy - size * Math.sin(angle - 0.4));
	g.moveTo(hx, hy);
	g.lineTo(hx - size * Math.cos(angle + 0.4), hy - size * Math.sin(angle + 0.4));
	g.stroke({ color, alpha, width: 1.5 });
}

function readThemeColors(): ThemeColors {
	const styles = getComputedStyle(document.body);
	const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
	return {
		node: cssColorToNumber(read("--graph-node", "var(--text-muted)")),
		nodeSelected: cssColorToNumber(read("--interactive-accent", "#7c3aed")),
		edge: cssColorToNumber(read("--graph-line", "var(--background-modifier-border)")),
		label: cssColorToNumber(read("--text-muted", "#888888")),
	};
}

/**
 * Pixi scene: node sprites in one batch, edges in a single Graphics that is
 * re-stroked only when positions change, labels created lazily above the
 * zoom threshold, viewport culling on every camera change.
 */
export class GraphRenderer {
	private app: Application | null = null;
	private world = new Container();
	private edgeMesh: EdgeMesh | null = null;
	private hullGraphics = new Graphics();
	private trailGraphics = new Graphics();
	private trailNodeIds: number[] = [];
	private trailProgress = 1;
	private nodeLayer = new Container();
	private labelLayer = new Container();
	private sprites: Sprite[] = [];
	private labels = new Map<number, Text>();
	private nodeTexture: Texture | null = null;
	/** Wide-halo variant used by the glow ("galaxy") color schemes. */
	private starTexture: Texture | null = null;
	private glowMode = false;
	/** Sprite size multiplier compensating the star texture's smaller core. */
	private spriteScale = 1;
	private viewport: Viewport | null = null;
	private colors: ThemeColors | null = null;
	private labelFontSize = DEFAULT_LABEL_FONT_SIZE;
	private labelZoomThreshold = DEFAULT_LABEL_ZOOM_THRESHOLD;
	/** Master label switch from the panel. */
	private labelsVisible = true;
	private labelMaxCount = LABEL_COUNT_LIMIT;
	/** true: labels live in world scale and tiny ones hide (scamin). */
	private labelScaleWithZoom = true;
	private edgeWidth = 1;
	private edgeOpacity = EDGE_ALPHA;
	private edgesVisible = true;
	/** Halo color behind label glyphs — theme background for contrast. */
	private labelHalo = 0x000000;

	private model: GraphModel | null = null;
	/** Raw xyz world positions (stride 3) straight from the layout worker. */
	private positions3: Float32Array | null = null;
	/** Static z override (cluster/age depth modes); null = physics z. */
	private depthOverride: Float32Array | null = null;
	/** Per-node perspective scale from the last projection. */
	private depthScales: Float32Array | null = null;
	readonly camera = new Camera3D();
	/** Projected 2D screen-space coordinates — the rest of the pipeline
	 *  (sprites, edges, culling, hit tests, hulls) only ever sees these. */
	private positions: Float32Array | null = null;
	private radii: Float32Array | null = null;
	private positionsDirty = false;
	private edgesDirty = false;
	private cullDirty = false;
	private hoveredId: number | null = null;
	/** Neighbors of the hovered node (undirected), for hover emphasis. */
	private hoverNeighbors = new Set<number>();
	private selectedId: number | null = null;

	constructor(private readonly callbacks: RendererCallbacks) {}

	async init(host: HTMLElement): Promise<void> {
		const app = new Application();
		await app.init({
			resizeTo: host,
			antialias: false, // MSAA on 30k edge lines costs several ms/frame; glow sprites hide the aliasing
			backgroundAlpha: 0,
			preference: "webgl",
		});
		this.app = app;
		host.appendChild(app.canvas);

		this.colors = readThemeColors();
		this.labelHalo = cssColorToNumber(
			getComputedStyle(document.body).getPropertyValue("--background-primary").trim() || "#1e1e1e"
		);
		this.nodeTexture = createNodeTexture(app.renderer);
		this.starTexture = createStarTexture(app.renderer);
		this.world.addChild(this.hullGraphics, this.nodeLayer, this.labelLayer, this.trailGraphics);
		app.stage.addChild(this.world);
		this.world.position.set(host.clientWidth / 2, host.clientHeight / 2);

		this.viewport = new Viewport(this.world, app.canvas, () => {
			this.cullDirty = true;
		});

		this.world.addChild(this.lassoGraphics);
		// In 3D, the wheel dollies the camera through the cloud (fly-through)
		// instead of scaling the flat picture. Capture phase so the 2D zoom
		// in Viewport never sees the event.
		app.canvas.addEventListener(
			"wheel",
			(event: WheelEvent) => {
				if (!this.camera.enabled) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				this.camera.fly(-event.deltaY * 1.5);
				this.reproject();
			},
			{ capture: true, passive: false }
		);
		app.canvas.addEventListener("pointerdown", this.handlePointerDown);
		app.canvas.addEventListener("contextmenu", this.handleContextMenu);
		// Move/up live on window so a drag keeps tracking outside the canvas.
		window.addEventListener("pointermove", this.handlePointerMove);
		window.addEventListener("pointerup", this.handlePointerUp);

		// Dev profiling hook: per-section CPU totals, read via window.__giProf.
		(window as unknown as { __giProf?: unknown }).__giProf = this.prof;
		app.ticker.add(() => this.renderFrame());
	}

	private prof = { sprites: 0, edges: 0, cull: 0, frames: 0 };

	setModel(model: GraphModel): void {
		if (!this.app || !this.nodeTexture || !this.colors) return;
		this.model = model;
		this.positions3 = new Float32Array(model.nodes.length * 3);
		this.positions = new Float32Array(model.nodes.length * 2);
		this.depthScales = new Float32Array(model.nodes.length);
		this.radii = new Float32Array(model.nodes.length);

		this.edgeMesh?.destroy();
		const edgePairs = new Uint32Array(model.edges.length * 2);
		for (let i = 0; i < model.edges.length; i++) {
			edgePairs[i * 2] = model.edges[i].source;
			edgePairs[i * 2 + 1] = model.edges[i].target;
		}
		this.edgeMesh = new EdgeMesh(edgePairs, this.colors.edge, this.edgeOpacity);
		this.edgeMesh.setVisible(this.edgesVisible);
		this.edgeMesh.setWidth(this.edgeWidth);
		this.world.addChildAt(this.edgeMesh.mesh, 1); // above hulls, below nodes

		this.nodeLayer.removeChildren();
		for (const label of this.labels.values()) label.destroy();
		this.labels.clear();
		this.sprites = [];

		for (const node of model.nodes) {
			const degree = node.inCount + node.outCount;
			const radius = Math.min(
				MAX_NODE_RADIUS,
				BASE_NODE_RADIUS + Math.sqrt(degree) * DEGREE_RADIUS_BOOST * BASE_NODE_RADIUS
			);
			this.radii[node.id] = radius;

			const sprite = new Sprite(this.glowMode ? this.starTexture! : this.nodeTexture);
			sprite.anchor.set(0.5);
			sprite.tint = this.colors.node;
			if (this.glowMode) sprite.blendMode = "add";
			sprite.setSize(radius * 2 * this.spriteScale);
			this.sprites.push(sprite);
			this.nodeLayer.addChild(sprite);
		}
		this.rebuildLabelPriority();
		this.edgesDirty = true;
		this.cullDirty = true;
	}

	/** New xyz frame from the layout worker (stride 3). */
	updatePositions(positions3: Float32Array): void {
		this.positions3 = positions3;
		this.reproject();
	}

	/** Re-run the camera projection into the 2D pipeline arrays. */
	private reproject(): void {
		if (!this.positions3) return;
		const count = this.positions3.length / 3;
		if (!this.positions || this.positions.length !== count * 2) {
			this.positions = new Float32Array(count * 2);
		}
		if (!this.depthScales || this.depthScales.length !== count) {
			this.depthScales = new Float32Array(count);
		}
		// depthOverride feeds the projection directly; positions3 stays pure
		// physics data (drag z, seeds and saved positions are not corrupted).
		this.camera.project(
			this.positions3,
			this.positions,
			this.depthScales!,
			this.camera.enabled ? this.depthOverride : null
		);
		this.syncEdgeVisibility();
		this.redrawHulls();
		if (this.camera.enabled) this.applyNodeAlpha(); // refresh depth fog
		this.positionsDirty = true;
		this.edgesDirty = true;
		this.cullDirty = true;
	}

	/** Enable/disable pseudo-3D; resets the camera only on the off→on
	 *  transition — repeated calls from settings changes must NOT touch
	 *  the current viewpoint. */
	set3DMode(enabled: boolean): void {
		const turningOn = enabled && !this.camera.enabled;
		this.camera.enabled = enabled;
		if (turningOn) {
			this.camera.yaw = 0.5;
			this.camera.pitch = -0.3;
			this.camera.px = 0;
			this.camera.py = 0;
			this.camera.pz = 0;
			// Flat zoom/pan would multiply on top of the perspective and make
			// the flight feel like scaling a picture — reset to identity.
			if (this.app && this.viewport) {
				this.world.scale.set(1);
				this.viewport.centerOn(0, 0, this.app.canvas.clientWidth, this.app.canvas.clientHeight);
			}
		}
		this.nodeLayer.sortableChildren = enabled;
		this.reproject();
	}

	private lastOffsetX = 0;
	private lastOffsetY = 0;

	/** Shift the camera center by screen-space pixels from the view middle. */
	setViewCenterOffset(dx: number, dy: number): void {
		if (!this.app || !this.viewport) return;
		if (this.camera.enabled) {
			this.camera.strafe(dx - this.lastOffsetX, dy - this.lastOffsetY);
			this.lastOffsetX = dx;
			this.lastOffsetY = dy;
			this.reproject();
			return;
		}
		this.lastOffsetX = dx;
		this.lastOffsetY = dy;
		const view = this.app.canvas;
		// Keep current zoom; recenter world origin at view middle + offset.
		this.viewport.centerOn(-dx / this.viewport.scale, -dy / this.viewport.scale, view.clientWidth, view.clientHeight);
	}

	/** Fit every visible node into the viewport. */
	fitAll(): void {
		if (!this.positions || !this.radii) return;
		if (this.camera.enabled && this.positions3) {
			// 3D: fly the camera back to где всё облако в кадре — fitting the
			// 2D projection would chase coordinates that move with the camera.
			let cx = 0, cy = 0, cz = 0;
			const count = this.positions3.length / 3;
			for (let i = 0; i < count; i++) {
				cx += this.positions3[i * 3];
				cy += this.positions3[i * 3 + 1];
				cz += this.positions3[i * 3 + 2];
			}
			cx /= count; cy /= count; cz /= count;
			let radius = 1;
			for (let i = 0; i < count; i++) {
				const d = Math.hypot(
					this.positions3[i * 3] - cx,
					this.positions3[i * 3 + 1] - cy,
					this.positions3[i * 3 + 2] - cz
				);
				if (d > radius) radius = d;
			}
			const [fx, fy, fz] = this.camera.forward();
			const distance = radius * 1.6;
			this.camera.px = cx - fx * distance;
			this.camera.py = cy - fy * distance;
			this.camera.pz = cz - fz * distance;
			this.reproject();
			return;
		}
		const ids: number[] = [];
		for (let i = 0; i < this.radii.length; i++) {
			if (this.hiddenMask === null || this.hiddenMask[i] === 0) ids.push(i);
		}
		this.zoomToNodes(ids);
	}

	/** Obsidian resizes panes without firing window.resize — Pixi's resizeTo
	 *  never notices, leaving a small canvas in a corner. Called from the
	 *  view's onResize. */
	resize(): void {
		if (!this.app) return;
		this.app.resize();
		if (this.camera.enabled && this.viewport) {
			this.world.scale.set(1);
			this.viewport.centerOn(0, 0, this.app.canvas.clientWidth, this.app.canvas.clientHeight);
		}
		this.cullDirty = true;
	}

	setCameraFocal(focal: number): void {
		this.camera.focal = focal;
		if (this.camera.enabled) this.reproject();
	}

	setDepthOverride(depths: Float32Array | null): void {
		this.depthOverride = depths;
		this.reproject();
	}

	setSelected(nodeId: number | null): void {
		this.selectedId = nodeId;
		this.applyNodeTints();
	}

	/** Custom tint per node from the encoding; -1 falls back to theme color. */
	private encodedTints: Int32Array | null = null;
	private encodedGlow: Float32Array | null = null;
	/** 1 = node matches the active overlay; others are dimmed. Null = off. */
	private dimMask: Uint8Array | null = null;
	/** 1 = node hidden (e.g. its cluster is switched off). */
	private hiddenMask: Uint8Array | null = null;

	applyEncoding(sizes: Float32Array, tints: Int32Array, glow: Float32Array): void {
		if (!this.radii || sizes.length !== this.sprites.length) return;
		this.encodedTints = tints;
		this.encodedGlow = glow;
		for (let i = 0; i < this.sprites.length; i++) {
			this.radii[i] = sizes[i];
			this.sprites[i].setSize(sizes[i] * 2 * this.spriteScale);
		}
		this.applyNodeTints();
		this.applyNodeAlpha();
		this.applyHoverSize();
		this.rebuildLabelPriority();
		this.cullDirty = true;
	}

	setDimMask(mask: Uint8Array | null): void {
		this.dimMask = mask;
		this.applyNodeAlpha();
	}

	/** Per-node alpha multiplier (search dim, focus falloff); null = off. */
	private alphaFactors: Float32Array | null = null;
	/** 1 = search match — tinted with the accent color so matches pop. */
	private highlightMask: Uint8Array | null = null;

	setHighlightMask(mask: Uint8Array | null): void {
		this.highlightMask = mask;
		this.applyNodeTints();
		this.applyHoverSize();
	}

	setAlphaFactors(factors: Float32Array | null): void {
		this.alphaFactors = factors;
		this.applyNodeAlpha();
	}

	setHiddenMask(mask: Uint8Array | null): void {
		this.hiddenMask = mask;
		this.syncEdgeVisibility();
		if (this.positions) {
			this.edgeMesh?.updatePositions(this.positions, this.camera.enabled ? this.depthScales : null);
		}
		this.cullDirty = true;
	}

	/** Edges must vanish for user-hidden nodes AND nodes behind the camera —
	 *  otherwise clipped endpoints drag lines into the screen center. */
	private mergedHiddenMask: Uint8Array | null = null;

	private syncEdgeVisibility(): void {
		if (!this.edgeMesh) return;
		let mask = this.hiddenMask;
		if (this.camera.enabled && this.depthScales) {
			if (!this.mergedHiddenMask || this.mergedHiddenMask.length !== this.depthScales.length) {
				this.mergedHiddenMask = new Uint8Array(this.depthScales.length);
			}
			const merged = this.mergedHiddenMask;
			for (let i = 0; i < merged.length; i++) {
				merged[i] = (mask !== null && mask[i] === 1) || this.depthScales[i] === 0 ? 1 : 0;
			}
			mask = merged;
		}
		this.edgeMesh.setHiddenNodes(mask);
	}

	/** Blow up the hovered sprite and lift it above the crowd. */
	private applyHoverSize(): void {
		if (!this.radii) return;
		for (let i = 0; i < this.sprites.length; i++) {
			const depth = this.camera.enabled && this.depthScales ? this.depthScales[i] : 1;
			const boost =
				i === this.hoveredId
					? HOVER_SIZE_BOOST
					: this.highlightMask !== null && this.highlightMask[i] === 1
						? HIGHLIGHT_SIZE_BOOST
						: 1;
			this.sprites[i].setSize(this.radii[i] * 2 * depth * boost * this.spriteScale);
		}
		if (this.hoveredId !== null) {
			// zIndex only matters when the layer is sorted (3D mode).
			this.sprites[this.hoveredId].zIndex = Number.MAX_SAFE_INTEGER;
		}
	}

	private applyNodeAlpha(): void {
		const fogged = this.camera.enabled && this.depthScales;
		for (let i = 0; i < this.sprites.length; i++) {
			const glow = this.encodedGlow ? this.encodedGlow[i] : 1;
			const dimmed = this.dimMask !== null && this.dimMask[i] === 0;
			const factor = this.alphaFactors ? this.alphaFactors[i] : 1;
			// Far fog: distant nodes fade. Near fade: nodes streaking past
			// the camera dissolve over the last ~200 world units instead of
			// popping out at the near plane.
			let fog = 1;
			if (fogged) {
				const depth = this.depthScales![i];
				fog = Math.min(1, Math.max(0.15, (depth - 0.35) * 1.4));
				if (depth > 1) {
					const distance = this.camera.focal / depth;
					fog *= Math.min(1, Math.max(0, (distance - 40) / 200));
				}
			}
			let alpha = (dimmed ? glow * DIM_ALPHA : glow) * factor * fog;
			if (this.hoveredId !== null) {
				if (i === this.hoveredId) alpha = 1;
				else if (this.hoverNeighbors.has(i)) alpha = Math.max(alpha, HOVER_NEIGHBOR_ALPHA);
				else alpha *= HOVER_REST_ALPHA;
			}
			this.sprites[i].alpha = alpha;
		}
	}

	/** Raw xyz (stride 3) — for seeding the next layout run. */
	get currentPositions(): Float32Array | null {
		return this.positions3;
	}

	get isDragging(): boolean {
		return this.draggingId !== null;
	}

	/** Projected screen-space xy (stride 2) — for pin coordinates etc. */
	get projectedPositions(): Float32Array | null {
		return this.positions;
	}

	/**
	 * Draw cluster bubbles: convex hull per node group with a soft fill.
	 * Called on layout settle / toggle, not per frame.
	 */
	private hullGroups: readonly { nodeIds: readonly number[]; color: number }[] | null = null;

	drawClusterHulls(groups: readonly { nodeIds: readonly number[]; color: number }[] | null): void {
		this.hullGroups = groups;
		this.redrawHulls();
	}

	/** Hulls live in projected space, so they must be rebuilt on every
	 *  camera move — otherwise the bubbles stay behind in 3D. */
	private redrawHulls(): void {
		const groups = this.hullGroups;
		const g = this.hullGraphics;
		g.clear();
		if (!groups || !this.positions) return;
		for (const group of groups) {
			if (group.nodeIds.length < 2) continue;
			const visible = group.nodeIds.filter(
				(id) => !(this.depthScales !== null && this.depthScales[id] === 0)
			);
			if (visible.length < 3) continue;
			const points: Point[] = visible.map((id) => ({
				x: this.positions![id * 2],
				y: this.positions![id * 2 + 1],
			}));
			const hull = padHull(convexHull(points), HULL_PADDING);
			if (hull.length < 3) continue;
			if (hull.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) continue;
			g.moveTo(hull[0].x, hull[0].y);
			for (let i = 1; i < hull.length; i++) g.lineTo(hull[i].x, hull[i].y);
			g.closePath();
			g.fill({ color: group.color, alpha: HULL_FILL_ALPHA });
		}
	}

	/** Session trail: node visit order; progress 0..1 for replay animation. */
	setSessionTrail(nodeIds: number[] | null, progress = 1): void {
		this.trailNodeIds = nodeIds ?? [];
		this.trailProgress = progress;
		this.redrawTrail();
	}

	private redrawTrail(): void {
		const g = this.trailGraphics;
		g.clear();
		const ids = this.trailNodeIds;
		if (ids.length < 2 || !this.positions || !this.colors) return;
		const segments = ids.length - 1;
		const shown = Math.max(1, Math.floor(segments * this.trailProgress));
		for (let i = 0; i < shown; i++) {
			const x1 = this.positions[ids[i] * 2];
			const y1 = this.positions[ids[i] * 2 + 1];
			const x2 = this.positions[ids[i + 1] * 2];
			const y2 = this.positions[ids[i + 1] * 2 + 1];
			// Older transitions fade out, newest are solid.
			const alpha = 0.15 + 0.75 * ((i + 1) / segments);
			g.moveTo(x1, y1);
			g.lineTo(x2, y2);
			g.stroke({ color: this.colors.nodeSelected, alpha, width: 1.5 });
			drawArrowHead(g, x1, y1, x2, y2, this.colors.nodeSelected, alpha);
		}
	}

	/** Current viewport rendered at 2x into a PNG blob. */
	async exportPng(): Promise<Blob | null> {
		if (!this.app) return null;
		const canvas = this.app.renderer.extract.canvas({
			target: this.app.stage,
			resolution: 2,
		}) as HTMLCanvasElement;
		return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
	}

	/** Center the viewport on a set of nodes and zoom to fit them. */
	zoomToNodes(nodeIds: readonly number[]): void {
		if (!this.app || !this.positions || !this.viewport || nodeIds.length === 0) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const id of nodeIds) {
			const x = this.positions[id * 2];
			const y = this.positions[id * 2 + 1];
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
		const view = this.app.canvas;
		this.viewport.fitBounds(minX, minY, maxX, maxY, view.clientWidth, view.clientHeight);
	}

	private applyNodeTints(): void {
		if (!this.colors) return;
		for (let i = 0; i < this.sprites.length; i++) {
			const isActive =
				i === this.selectedId ||
				i === this.hoveredId ||
				this.hoverNeighbors.has(i) ||
				(this.highlightMask !== null && this.highlightMask[i] === 1);
			const encoded = this.encodedTints ? this.encodedTints[i] : -1;
			this.sprites[i].tint = isActive
				? this.colors.nodeSelected
				: encoded >= 0 ? encoded : this.colors.node;
		}
	}

	private renderFrame(): void {
		if (!this.model || !this.positions || !this.radii) return;

		this.prof.frames++;
		if (this.positionsDirty) {
			const t0 = performance.now();
			const threeD = this.camera.enabled && this.depthScales;
			for (let i = 0; i < this.sprites.length; i++) {
				const sprite = this.sprites[i];
				sprite.position.set(this.positions[i * 2], this.positions[i * 2 + 1]);
				if (threeD) {
					const depth = this.depthScales![i];
					const boost =
						i === this.hoveredId
							? HOVER_SIZE_BOOST
							: this.highlightMask !== null && this.highlightMask[i] === 1
								? HIGHLIGHT_SIZE_BOOST
								: 1;
					sprite.setSize(this.radii![i] * 2 * depth * boost * this.spriteScale);
					sprite.zIndex = i === this.hoveredId ? Number.MAX_SAFE_INTEGER : depth;
				}
			}
			this.positionsDirty = false;
			this.prof.sprites += performance.now() - t0;
		}

		if (this.edgesDirty) {
			const t0 = performance.now();
			this.edgesDirty = false;
			this.edgeMesh?.updatePositions(this.positions, this.camera.enabled ? this.depthScales : null);
			this.redrawTrail();
			this.prof.edges += performance.now() - t0;
		}
		if (this.cullDirty) {
			const now = performance.now();
			// Culling correctness can lag a frame or two; don't let it eat
			// the budget on every single frame of a running simulation.
			if (now - this.lastCullAt >= CULL_MIN_INTERVAL_MS) {
				this.lastCullAt = now;
				this.cullDirty = false;
				this.cullAndLabel(); // may re-set cullDirty to finish deferred labels
				this.prof.cull += performance.now() - now;
			}
		}
	}

	private lastCullAt = 0;

	private cullAndLabel(): void {
		if (!this.app || !this.model || !this.positions || !this.radii || !this.viewport) return;
		const scale = this.viewport.scale;
		const view = this.app.canvas;
		const topLeft = this.viewport.toWorld(0, 0);
		const bottomRight = this.viewport.toWorld(view.clientWidth, view.clientHeight);
		const margin = MAX_NODE_RADIUS;

		const isOnScreen = (i: number) => {
			const x = this.positions![i * 2];
			const y = this.positions![i * 2 + 1];
			return (
				x >= topLeft.x - margin && x <= bottomRight.x + margin &&
				y >= topLeft.y - margin && y <= bottomRight.y + margin
			);
		};

		for (let i = 0; i < this.sprites.length; i++) {
			const bigEnough = this.radii[i] * scale >= TINY_NODE_CULL_PX;
			const hidden = this.hiddenMask !== null && this.hiddenMask[i] === 1;
			this.sprites[i].visible = isOnScreen(i) && bigEnough && !hidden;
		}

		// Labels go to the most important (largest) nodes first, not to
		// whichever happens to come first in file order.
		//
		// In 3D the world is never scaled — the camera flies instead — so the
		// flat zoom stays pinned at 1 and any threshold above 1 would wipe out
		// every label. There the threshold applies per node against its
		// perspective depth: raising it keeps labels on nearer nodes only.
		const depthGated = this.camera.enabled && this.depthScales !== null;
		const showLabels = this.labelsVisible && (depthGated || scale >= this.labelZoomThreshold);
		const readable = !this.labelScaleWithZoom || this.labelFontSize * scale >= MIN_LABEL_SCREEN_PX;
		let labelBudget = showLabels && readable ? this.labelMaxCount : 0;
		let creationBudget = NEW_LABELS_PER_FRAME;
		let creationSkipped = false;
		const labeled = new Set<number>();

		// In 3D the labels belong to whatever is closest to the camera —
		// that's what the eye reads as "the foreground".
		let order: readonly number[] = this.labelPriority;
		if (this.camera.enabled && this.depthScales) {
			const depths = this.depthScales;
			order = Array.from(depths.keys()).sort((a, b) => depths[b] - depths[a]);
		}
		if (labelBudget > 0) {
			for (const i of order) {
				if (labelBudget <= 0) break;
				const hidden =
					(this.hiddenMask !== null && this.hiddenMask[i] === 1) ||
					(this.depthScales !== null && this.depthScales[i] === 0) ||
					(depthGated && this.depthScales![i] < this.labelZoomThreshold);
				// No node-size gate: priority order already favors important
				// nodes, and a small «Размер узлов» must not kill every label.
				if (hidden || !isOnScreen(i)) continue;
				if (this.labels.has(i)) {
					labelBudget--;
					labeled.add(i);
					this.ensureLabel(i, this.positions[i * 2], this.positions[i * 2 + 1]);
				} else if (creationBudget > 0) {
					labelBudget--;
					creationBudget--;
					labeled.add(i);
					this.ensureLabel(i, this.positions[i * 2], this.positions[i * 2 + 1]);
				} else {
					creationSkipped = true;
				}
			}
		}
		for (const [i, label] of this.labels) {
			if (!labeled.has(i)) label.visible = false;
		}

		// Some labels were deferred to keep the frame smooth; finish them on
		// the next frames until the visible set is fully labeled.
		if (creationSkipped) this.cullDirty = true;
	}

	/** Node ids sorted by radius, largest first — label priority order. */
	private labelPriority: number[] = [];

	private rebuildLabelPriority(): void {
		if (!this.radii) {
			this.labelPriority = [];
			return;
		}
		this.labelPriority = Array.from(this.radii.keys())
			.sort((a, b) => this.radii![b] - this.radii![a]);
	}

	/** Change label rendering options; existing label cache is rebuilt lazily. */
	setLabelOptions(
		show: boolean,
		fontSize: number,
		zoomThreshold: number,
		maxCount: number,
		scaleWithZoom: boolean
	): void {
		const changed = fontSize !== this.labelFontSize;
		this.labelsVisible = show;
		this.labelFontSize = fontSize;
		this.labelZoomThreshold = zoomThreshold;
		this.labelMaxCount = maxCount;
		this.labelScaleWithZoom = scaleWithZoom;
		if (changed) {
			for (const label of this.labels.values()) label.destroy();
			this.labels.clear();
		}
		this.cullDirty = true;
	}

	setEdgeStyle(show: boolean, width: number, opacity: number): void {
		this.edgesVisible = show;
		this.edgeWidth = width;
		this.edgeOpacity = opacity;
		this.edgeMesh?.setVisible(show);
		this.edgeMesh?.setAlpha(opacity);
		this.edgeMesh?.setWidth(width);
	}

	/**
	 * Glow schemes swap the node texture and switch to additive blending, so
	 * overlapping nodes bloom like stars. Idempotent: repeated calls with the
	 * same style do nothing, keeping panel changes free of visual resets.
	 */
	setVisualStyle(glow: boolean, backdrop: number | null): void {
		if (this.app) {
			this.app.renderer.background.alpha = backdrop === null ? 0 : 1;
			if (backdrop !== null) this.app.renderer.background.color = backdrop;
		}
		if (glow === this.glowMode) return;
		this.glowMode = glow;
		this.spriteScale = glow ? STAR_SIZE_FACTOR : 1;

		const texture = glow ? this.starTexture : this.nodeTexture;
		if (!texture) return;
		for (const sprite of this.sprites) {
			sprite.texture = texture;
			sprite.blendMode = glow ? "add" : "normal";
		}
		this.applyHoverSize(); // re-applies every sprite size with the new scale
		this.cullDirty = true;
	}

	private ensureLabel(nodeId: number, x: number, y: number): void {
		if (!this.model || !this.colors || !this.radii) return;
		let label = this.labels.get(nodeId);
		if (!label) {
			label = new Text({
				text: this.model.nodes[nodeId].name,
				style: {
					fill: this.colors.label,
					fontSize: this.labelFontSize,
					fontFamily: getComputedStyle(document.body).getPropertyValue("--font-interface") || "sans-serif",
					// Halo in the theme background color keeps text readable
					// on top of edges and glowing nodes.
					stroke: { color: this.labelHalo, width: Math.max(1.5, this.labelFontSize / 6) },
				},
				resolution: 2,
			});
			label.anchor.set(0.5, 0);
			this.labels.set(nodeId, label);
			this.labelLayer.addChild(label);
		}
		label.position.set(x, y + this.radii[nodeId] + 2);
		// Depth-matched label brightness: near labels glow, far ones dim.
		if (this.camera.enabled && this.depthScales) {
			const depth = this.depthScales[nodeId];
			label.alpha = Math.min(1, Math.max(0.25, (depth - 0.3) * 1.6));
		} else {
			label.alpha = 1;
		}
		// World-scaled labels shrink on zoom-out (quieter picture) but stop
		// growing past ~1.4× their font size when zooming in deep; the
		// alternative keeps constant screen size.
		const viewScale = Math.max(this.viewport!.scale, 0.001);
		label.scale.set(this.labelScaleWithZoom ? Math.min(1, 1.4 / viewScale) : 1 / viewScale);
		label.visible = true;
	}

	private findNodeAt(clientX: number, clientY: number): number | null {
		if (!this.app || !this.positions || !this.radii || !this.viewport) return null;
		const rect = this.app.canvas.getBoundingClientRect();
		const point = this.viewport.toWorld(clientX - rect.left, clientY - rect.top);
		const hitRadiusWorld = HOVER_RADIUS_PX / this.viewport.scale;

		let best: number | null = null;
		let bestDistance = Infinity;
		for (let i = 0; i < this.radii.length; i++) {
			if (this.hiddenMask !== null && this.hiddenMask[i] === 1) continue;
			if (this.depthScales !== null && this.depthScales[i] === 0) continue;
			const dx = this.positions[i * 2] - point.x;
			const dy = this.positions[i * 2 + 1] - point.y;
			const distance = Math.hypot(dx, dy);
			// Visual radius includes the 3D depth scale, else near/far nodes
			// miss clicks in 3D mode.
			const visualRadius = this.radii[i] * (this.depthScales ? this.depthScales[i] : 1);
			if (distance <= Math.max(visualRadius, hitRadiusWorld) && distance < bestDistance) {
				best = i;
				bestDistance = distance;
			}
		}
		return best;
	}

	/** Node pressed but not yet moved past the drag threshold. */
	private pressedId: number | null = null;
	private pressedEvent: PointerEvent | null = null;
	private draggingId: number | null = null;
	private lastClickAt = 0;
	private lastClickId: number | null = null;
	private orbiting = false;
	private orbitLastX = 0;
	private orbitLastY = 0;
	private rmbPanning = false;
	private rmbMoved = false;
	private rmbLastX = 0;
	private rmbLastY = 0;
	/** World-space lasso path while Shift+drag is active. */
	private lassoPoints: Point[] | null = null;
	private lassoGraphics = new Graphics();

	private updateHoverNeighbors(): void {
		this.hoverNeighbors.clear();
		if (this.hoveredId === null || !this.model) return;
		for (const edge of this.model.edges) {
			if (edge.source === this.hoveredId) this.hoverNeighbors.add(edge.target);
			else if (edge.target === this.hoveredId) this.hoverNeighbors.add(edge.source);
		}
	}

	private handlePointerMove = (event: PointerEvent): void => {
		if (this.rmbPanning) {
			const dx = event.clientX - this.rmbLastX;
			const dy = event.clientY - this.rmbLastY;
			if (Math.abs(dx) + Math.abs(dy) > 0) this.rmbMoved = true;
			this.rmbLastX = event.clientX;
			this.rmbLastY = event.clientY;
			if (this.camera.enabled) {
				// Strafe the camera: the vanishing point stays glued to the
				// screen center, so flight always converges into the middle.
				this.camera.strafe(-dx, -dy);
				this.reproject();
			} else {
				this.world.position.x += dx;
				this.world.position.y += dy;
				this.cullDirty = true;
			}
			return;
		}
		if (this.orbiting) {
			this.camera.yaw += (event.clientX - this.orbitLastX) * 0.005;
			this.camera.pitch = Math.max(
				-1.45,
				Math.min(1.45, this.camera.pitch + (event.clientY - this.orbitLastY) * 0.005)
			);
			this.orbitLastX = event.clientX;
			this.orbitLastY = event.clientY;
			this.reproject();
			return;
		}
		if (this.lassoPoints) {
			this.extendLasso(event);
			return;
		}
		if (this.draggingId !== null) {
			this.moveDraggedNode(event);
			return;
		}
		if (this.pressedId !== null && this.pressedEvent) {
			const travel = Math.hypot(
				event.clientX - this.pressedEvent.clientX,
				event.clientY - this.pressedEvent.clientY
			);
			if (travel >= DRAG_THRESHOLD_PX) {
				this.draggingId = this.pressedId;
				if (this.viewport) this.viewport.suppressPan = true;
				this.callbacks.onNodeDragStart(this.draggingId);
				this.moveDraggedNode(event);
				return;
			}
		}
		const nodeId = this.findNodeAt(event.clientX, event.clientY);
		if (nodeId !== this.hoveredId) {
			this.hoveredId = nodeId;
			this.updateHoverNeighbors();
			this.applyNodeTints();
			this.applyNodeAlpha();
			this.applyHoverSize();
		}
		this.callbacks.onNodeHover(nodeId, event.clientX, event.clientY);
	};

	private moveDraggedNode(event: PointerEvent): void {
		if (this.draggingId === null || !this.app || !this.positions3 || !this.viewport) return;
		const rect = this.app.canvas.getBoundingClientRect();
		const point = this.viewport.toWorld(event.clientX - rect.left, event.clientY - rect.top);
		const id = this.draggingId;

		if (this.camera.enabled && this.depthScales && this.positions) {
			// Move in the screen plane at the node's depth; z stays put.
			const dxScreen = point.x - this.positions[id * 2];
			const dyScreen = point.y - this.positions[id * 2 + 1];
			const [dx, dy, dz] = this.camera.unprojectDelta(dxScreen, dyScreen, this.depthScales[id]);
			this.positions3[id * 3] += dx;
			this.positions3[id * 3 + 1] += dy;
			this.positions3[id * 3 + 2] += dz;
		} else {
			this.positions3[id * 3] = point.x;
			this.positions3[id * 3 + 1] = point.y;
		}
		this.reproject();
		this.callbacks.onNodeDrag(
			id,
			this.positions3[id * 3],
			this.positions3[id * 3 + 1],
			this.positions3[id * 3 + 2]
		);
	}

	private handlePointerDown = (event: PointerEvent): void => {
		if (event.button === 2) {
			// Right-drag pans the camera; over a node it stays a context menu.
			if (this.findNodeAt(event.clientX, event.clientY) === null) {
				this.rmbPanning = true;
				this.rmbMoved = false;
				this.rmbLastX = event.clientX;
				this.rmbLastY = event.clientY;
			}
			return;
		}
		if (event.button !== 0) return;
		if (event.shiftKey) {
			this.startLasso(event);
			return;
		}
		const nodeId = this.findNodeAt(event.clientX, event.clientY);
		if (nodeId === null) {
			if (this.camera.enabled) {
				// Empty-area drag rotates the 3D view; hold Alt to pan instead.
				if (!event.altKey) {
					this.orbiting = true;
					this.orbitLastX = event.clientX;
					this.orbitLastY = event.clientY;
					if (this.viewport) this.viewport.suppressPan = true;
				}
			}
			return;
		}
		this.pressedId = nodeId;
		this.pressedEvent = event;
		// Block panning immediately: the press landed on a node, so this
		// gesture is either a click or a node drag, never a camera pan.
		if (this.viewport) this.viewport.suppressPan = true;
	};

	private handlePointerUp = (event: PointerEvent): void => {
		if (this.rmbPanning && event.button === 2) {
			this.rmbPanning = false;
			return;
		}
		if (this.orbiting) {
			this.orbiting = false;
			if (this.viewport) this.viewport.suppressPan = false;
			return;
		}
		if (this.lassoPoints) {
			this.finishLasso(event);
			return;
		}
		if (this.draggingId !== null) {
			this.callbacks.onNodeDragEnd(this.draggingId);
			this.draggingId = null;
		} else if (this.pressedId !== null && this.pressedEvent) {
			const now = performance.now();
			if (this.lastClickId === this.pressedId && now - this.lastClickAt < DOUBLE_CLICK_MS) {
				this.callbacks.onNodeDoubleClick(this.pressedId);
				this.lastClickId = null;
			} else {
				this.callbacks.onNodeClick(this.pressedId, this.pressedEvent);
				this.lastClickId = this.pressedId;
				this.lastClickAt = now;
			}
		}
		this.pressedId = null;
		this.pressedEvent = null;
		if (this.viewport) this.viewport.suppressPan = false;
	};

	private handleContextMenu = (event: MouseEvent): void => {
		if (this.rmbMoved) {
			// The right button was used for panning, not for a menu.
			event.preventDefault();
			this.rmbMoved = false;
			return;
		}
		const nodeId = this.findNodeAt(event.clientX, event.clientY);
		if (nodeId === null) return;
		event.preventDefault();
		this.callbacks.onNodeContextMenu(nodeId, event);
	};

	private toWorldPoint(event: { clientX: number; clientY: number }): Point | null {
		if (!this.app || !this.viewport) return null;
		const rect = this.app.canvas.getBoundingClientRect();
		return this.viewport.toWorld(event.clientX - rect.left, event.clientY - rect.top);
	}

	private startLasso(event: PointerEvent): void {
		const point = this.toWorldPoint(event);
		if (!point) return;
		this.lassoPoints = [point];
		if (this.viewport) this.viewport.suppressPan = true;
	}

	private extendLasso(event: PointerEvent): void {
		const point = this.toWorldPoint(event);
		if (!point || !this.lassoPoints) return;
		this.lassoPoints.push(point);
		const g = this.lassoGraphics;
		g.clear();
		g.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
		for (const p of this.lassoPoints) g.lineTo(p.x, p.y);
		g.stroke({
			color: this.colors?.nodeSelected ?? 0x7c3aed,
			alpha: 0.8,
			width: 1.5 / (this.viewport?.scale ?? 1),
		});
	}

	private finishLasso(event: PointerEvent): void {
		const polygon = this.lassoPoints;
		this.lassoPoints = null;
		this.lassoGraphics.clear();
		if (this.viewport) this.viewport.suppressPan = false;
		if (!polygon || polygon.length < 3 || !this.positions || !this.radii) return;

		const selected: number[] = [];
		for (let i = 0; i < this.radii.length; i++) {
			if (this.hiddenMask !== null && this.hiddenMask[i] === 1) continue;
			const point = { x: this.positions[i * 2], y: this.positions[i * 2 + 1] };
			if (pointInPolygon(point, polygon)) selected.push(i);
		}
		if (selected.length > 0) this.callbacks.onLassoSelect(selected, event);
	}

	destroy(): void {
		this.viewport?.destroy();
		this.edgeMesh?.destroy();
		this.edgeMesh = null;
		if (this.app) {
			this.app.canvas.removeEventListener("pointerdown", this.handlePointerDown);
			this.app.canvas.removeEventListener("contextmenu", this.handleContextMenu);
			window.removeEventListener("pointermove", this.handlePointerMove);
			window.removeEventListener("pointerup", this.handlePointerUp);
			this.app.destroy(true, { children: true, texture: true });
			this.app = null;
		}
	}
}
