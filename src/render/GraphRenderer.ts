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
import { DRAG_THRESHOLD_PX, dragTargetPosition, isDragGesture } from "./dragMath";
import { EdgeMesh } from "./EdgeMesh";
import { DEAD_ZONE_PX, MAX_AIM_ANGLE, pickAimedNeighbor } from "../explore/aiming";
import { HOVER_RADIUS_PX, pickNodeAt } from "./hitTest";
import {
	emphasisBoost,
	fogFactor,
	mergeHiddenMask,
	nodeAlpha,
	pinRingRadius,
	sizeDepth,
} from "./nodeAppearance";
import { createNodeTexture, createStarTexture, STAR_SIZE_FACTOR } from "./NodeTexture";
import { Camera3D } from "./projection";
import { Viewport } from "./Viewport";

const BASE_NODE_RADIUS = 4;
const DEGREE_RADIUS_BOOST = 0.35; // radius grows with sqrt(degree)
const MAX_NODE_RADIUS = 16;
const DEFAULT_LABEL_ZOOM_THRESHOLD = 0.9;
const DEFAULT_LABEL_FONT_SIZE = 11;
const LABEL_COUNT_LIMIT = 150;
const TINY_NODE_CULL_PX = 0.35; // nodes smaller than this on screen are skipped
const EDGE_ALPHA = 0.25;
// Text rasterization is expensive; creating many labels in one frame causes
// visible hitches during panning, so budget creations per frame.
const NEW_LABELS_PER_FRAME = 4;
const CULL_MIN_INTERVAL_MS = 30;
const MIN_LABEL_SCREEN_PX = 8;
const DOUBLE_CLICK_MS = 350;
const HULL_FILL_ALPHA = 0.1;
const HULL_PADDING = 18;
/** Pin rings: present enough to spot, quiet enough not to compete with nodes. */
const PIN_RING_ALPHA = 0.8;
const PIN_RING_WIDTH = 1.2;
// Explore mode draws its own links on top of the edge mesh: travellable links
// brighter than the graph behind them, the armed one brighter still.
const EXPLORE_LINK_ALPHA = 0.45;
const EXPLORE_LINK_WIDTH = 1.2;
const EXPLORE_CANDIDATE_ALPHA = 1;
const EXPLORE_CANDIDATE_WIDTH = 3.5;
/** Share of its normal opacity the rest of the link web keeps in explore mode. */
const EXPLORE_BACKGROUND_EDGE_DIM = 0.12;

/** What explore mode wants drawn: the node under the camera, the links it can
 *  travel down, and which one the pointer is aiming at. */
export interface ExploreOverlay {
	centerId: number;
	neighbors: readonly number[];
	candidateId: number | null;
}

export interface RendererCallbacks {
	onNodeHover(nodeId: number | null, clientX: number, clientY: number): void;
	onNodeClick(nodeId: number, event: PointerEvent): void;
	onNodeDoubleClick(nodeId: number): void;
	onNodeMiddleClick(nodeId: number): void;
	onNodeContextMenu(nodeId: number, event: MouseEvent): void;
	onNodeDragStart(nodeId: number): void;
	onNodeDrag(nodeId: number, worldX: number, worldY: number, worldZ: number): void;
	onNodeDragEnd(nodeId: number): void;
	onLassoSelect(nodeIds: number[], event: PointerEvent): void;
	/** Explore mode: which link the pointer is aiming down (null = none), and
	 *  where the pointer is, so the note it leads to can be named there. */
	onExploreAim(nodeId: number | null, clientX: number, clientY: number): void;
	/** Explore mode: a click on the armed link — depart now. */
	onExploreJump(): void;
	/** The GPU dropped the WebGL context (driver reset, sleep, another app
	 *  taking the GPU). Nothing renders until the view is rebuilt. */
	onContextLost(): void;
}

interface ThemeColors {
	node: number;
	nodeSelected: number;
	edge: number;
	label: number;
}

function cssColorToNumber(value: string): number {
	const probe = createEl("div");
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
	private exploreGraphics = new Graphics();
	private explore: ExploreOverlay | null = null;
	private pinGraphics = new Graphics();
	private pinnedIds: ReadonlySet<number> = new Set();
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
	/** Set once the GPU context is gone; every draw call after that is a no-op. */
	private contextLost = false;

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
		// Without preventDefault the browser will not even try to hand the
		// context back. Pixi cannot rebuild its GPU resources on its own, so the
		// view is told to start over rather than left with a blank canvas.
		app.canvas.addEventListener("webglcontextlost", (event) => {
			event.preventDefault();
			this.contextLost = true;
			console.error("Advanced Graph View: WebGL context lost");
			this.callbacks.onContextLost();
		});

		this.colors = readThemeColors();
		this.labelHalo = cssColorToNumber(
			getComputedStyle(document.body).getPropertyValue("--background-primary").trim() || "#1e1e1e"
		);
		this.nodeTexture = createNodeTexture(app.renderer);
		this.starTexture = createStarTexture(app.renderer);
		this.world.addChild(
			this.hullGraphics,
			this.nodeLayer,
			this.pinGraphics,
			this.labelLayer,
			this.trailGraphics,
			this.exploreGraphics
		);
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

		app.ticker.add(() => this.renderFrame());
	}

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
		// While a drag is active the local pointer position is fresher than the
		// worker frame (the worker echoes the previous drag-move), so keep the
		// local coords — otherwise the grabbed node rubber-bands behind the
		// cursor as stale frames overwrite it.
		if (
			this.draggingId !== null &&
			this.positions3 &&
			this.positions3.length === positions3.length
		) {
			const i = this.draggingId * 3;
			positions3[i] = this.positions3[i];
			positions3[i + 1] = this.positions3[i + 1];
			positions3[i + 2] = this.positions3[i + 2];
		}
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
			this.depthScales,
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
			// Sit the camera outside the cloud looking at its center, so orbiting
			// spins the whole scene around the center instead of turning in place.
			this.frameCloud();
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

	/** Position the 3D camera outside the cloud, pulled back along its look
	 *  direction so the whole graph is framed and centered. No-op in 2D or
	 *  before positions exist. */
	private frameCloud(): void {
		if (!this.camera.enabled || !this.positions3) {
			this.camera.px = 0;
			this.camera.py = 0;
			this.camera.pz = 0;
			return;
		}
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
		// Remember the center so orbiting pivots exactly around it.
		this.camera.tx = cx;
		this.camera.ty = cy;
		this.camera.tz = cz;
	}

	/** Fit every visible node into the viewport. */
	fitAll(): void {
		if (!this.positions || !this.radii) return;
		if (this.camera.enabled && this.positions3) {
			// 3D: fly the camera back to где всё облако в кадре — fitting the
			// 2D projection would chase coordinates that move with the camera.
			this.frameCloud();
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
		const { mask, buffer } = mergeHiddenMask(
			this.hiddenMask,
			this.camera.enabled ? this.depthScales : null,
			this.mergedHiddenMask
		);
		this.mergedHiddenMask = buffer;
		this.edgeMesh.setHiddenNodes(mask);
	}

	/** Blow up the hovered sprite and lift it above the crowd. */
	private applyHoverSize(): void {
		if (!this.radii) return;
		for (let i = 0; i < this.sprites.length; i++) {
			const depth = this.camera.enabled && this.depthScales ? this.depthScales[i] : 1;
			const boost = emphasisBoost(
				i === this.hoveredId,
				this.highlightMask !== null && this.highlightMask[i] === 1
			);
			this.sprites[i].setSize(this.radii[i] * 2 * sizeDepth(depth) * boost * this.spriteScale);
		}
		if (this.hoveredId !== null) {
			// zIndex only matters when the layer is sorted (3D mode).
			this.sprites[this.hoveredId].zIndex = Number.MAX_SAFE_INTEGER;
		}
	}

	private applyNodeAlpha(): void {
		const fogged = this.camera.enabled && this.depthScales;
		for (let i = 0; i < this.sprites.length; i++) {
			this.sprites[i].alpha = nodeAlpha({
				glow: this.encodedGlow ? this.encodedGlow[i] : 1,
				dimmed: this.dimMask !== null && this.dimMask[i] === 0,
				factor: this.alphaFactors ? this.alphaFactors[i] : 1,
				fog: fogged ? fogFactor(this.depthScales![i], this.camera.focal) : 1,
				hoverActive: this.hoveredId !== null,
				isHovered: i === this.hoveredId,
				isHoverNeighbor: this.hoverNeighbors.has(i),
			});
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

	/** Nodes the user has pinned in place. Drawn as rings so a pin is visible
	 *  without a tooltip — otherwise a node that ignores physics looks broken. */
	setPinned(ids: ReadonlySet<number>): void {
		this.pinnedIds = ids;
		this.redrawPins();
	}

	private redrawPins(): void {
		const g = this.pinGraphics;
		g.clear();
		if (this.pinnedIds.size === 0 || !this.positions || !this.radii || !this.colors) return;
		for (const id of this.pinnedIds) {
			if (id >= this.radii.length) continue;
			const depth = this.depthScales ? this.depthScales[id] : 1;
			// Behind the camera: the sprite is hidden, so the ring must be too.
			if (depth <= 0) continue;
			g.circle(
				this.positions[id * 2],
				this.positions[id * 2 + 1],
				pinRingRadius(this.radii[id], depth, this.spriteScale)
			);
			g.stroke({ color: this.colors.nodeSelected, alpha: PIN_RING_ALPHA, width: PIN_RING_WIDTH });
		}
	}

	/** Explore mode: what to draw around the node under the camera; null off. */
	setExploreOverlay(overlay: ExploreOverlay | null): void {
		const wasExploring = this.explore !== null;
		this.explore = overlay;
		// The rest of the vault's links are the loudest thing on screen once
		// the nodes are dimmed, so fade the whole edge mesh while the mode
		// draws its own links on top of it.
		if (wasExploring !== (overlay !== null)) {
			this.edgeMesh?.setAlpha(overlay ? this.edgeOpacity * EXPLORE_BACKGROUND_EDGE_DIM : this.edgeOpacity);
		}
		// The pointer stops picking nodes in explore mode, so whatever was
		// hovered when it started would stay swollen and tinted for good.
		if (overlay && this.hoveredId !== null) {
			this.hoveredId = null;
			this.updateHoverNeighbors();
			this.applyNodeTints();
			this.applyNodeAlpha();
			this.applyHoverSize();
		}
		this.redrawExplore();
	}

	/** Whether explore mode is currently driving the pointer. */
	get isExploring(): boolean {
		return this.explore !== null;
	}

	/** World position of a node, or null while no layout has arrived. */
	nodePosition(id: number): { x: number; y: number; z: number } | null {
		if (!this.positions3 || id * 3 + 2 >= this.positions3.length) return null;
		return {
			x: this.positions3[id * 3],
			y: this.positions3[id * 3 + 1],
			z: this.positions3[id * 3 + 2],
		};
	}

	/** Node drawn closest to the middle of the view — where explore mode
	 *  starts when the user has not picked a node itself. */
	/** Pan so one node sits in the middle of the pane, at the current zoom.
	 *  Works off projected coordinates, so 3D follows along with 2D. */
	centerOnNode(nodeId: number): void {
		if (!this.app || !this.viewport || !this.positions) return;
		if (nodeId * 2 + 1 >= this.positions.length) return;
		this.viewport.centerOn(
			this.positions[nodeId * 2],
			this.positions[nodeId * 2 + 1],
			this.app.canvas.clientWidth,
			this.app.canvas.clientHeight
		);
	}

	nodeNearestToViewCenter(): number | null {
		if (!this.app || !this.positions || !this.viewport) return null;
		const canvas = this.app.canvas;
		const center = this.viewport.toWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);

		let best: number | null = null;
		let bestDistance = Infinity;
		for (let i = 0; i < this.positions.length / 2; i++) {
			if (this.hiddenMask !== null && this.hiddenMask[i] === 1) continue;
			if (this.depthScales !== null && this.depthScales[i] === 0) continue;
			const distance = Math.hypot(
				this.positions[i * 2] - center.x,
				this.positions[i * 2 + 1] - center.y
			);
			if (distance < bestDistance) {
				best = i;
				bestDistance = distance;
			}
		}
		return best;
	}

	/** Camera position in world space — the start point of an explore flight. */
	get cameraPosition(): { x: number; y: number; z: number } {
		return { x: this.camera.px, y: this.camera.py, z: this.camera.pz };
	}

	/**
	 * Put the camera at `position` looking at `pivot`, keeping its angle.
	 * The pivot matters beyond the picture: orbiting spins around it, so after
	 * a hop the graph turns around the node you landed on, not around wherever
	 * the camera started the session.
	 */
	placeCamera(
		position: { x: number; y: number; z: number },
		pivot: { x: number; y: number; z: number }
	): void {
		this.camera.px = position.x;
		this.camera.py = position.y;
		this.camera.pz = position.z;
		this.camera.tx = pivot.x;
		this.camera.ty = pivot.y;
		this.camera.tz = pivot.z;
		this.reproject();
	}

	private redrawExplore(): void {
		const g = this.exploreGraphics;
		g.clear();
		const overlay = this.explore;
		if (!overlay || !this.positions || !this.colors) return;

		const centerX = this.positions[overlay.centerId * 2];
		const centerY = this.positions[overlay.centerId * 2 + 1];

		for (const id of overlay.neighbors) {
			if (this.hiddenMask !== null && this.hiddenMask[id] === 1) continue;
			if (this.depthScales !== null && this.depthScales[id] === 0) continue;
			const x = this.positions[id * 2];
			const y = this.positions[id * 2 + 1];
			const isCandidate = id === overlay.candidateId;

			g.moveTo(centerX, centerY);
			g.lineTo(x, y);
			g.stroke({
				color: isCandidate ? this.colors.nodeSelected : this.colors.edge,
				alpha: isCandidate ? EXPLORE_CANDIDATE_ALPHA : EXPLORE_LINK_ALPHA,
				width: isCandidate ? EXPLORE_CANDIDATE_WIDTH : EXPLORE_LINK_WIDTH,
			});

			// An arrow on the aimed link says which way the trip would go —
			// with two notes lit up, the direction is the missing half.
			if (isCandidate) drawArrowHead(g, centerX, centerY, x, y, this.colors.nodeSelected, 1);
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
		if (this.contextLost) return;
		if (!this.model || !this.positions || !this.radii) return;

		if (this.positionsDirty) {
			const threeD = this.camera.enabled && this.depthScales;
			for (let i = 0; i < this.sprites.length; i++) {
				const sprite = this.sprites[i];
				sprite.position.set(this.positions[i * 2], this.positions[i * 2 + 1]);
				if (threeD) {
					const depth = threeD[i];
					const boost = emphasisBoost(
						i === this.hoveredId,
						this.highlightMask !== null && this.highlightMask[i] === 1
					);
					sprite.setSize(this.radii[i] * 2 * sizeDepth(depth) * boost * this.spriteScale);
					sprite.zIndex = i === this.hoveredId ? Number.MAX_SAFE_INTEGER : depth;
				}
			}
			this.positionsDirty = false;
		}

		if (this.edgesDirty) {
			this.edgesDirty = false;
			this.edgeMesh?.updatePositions(this.positions, this.camera.enabled ? this.depthScales : null);
			this.redrawTrail();
			this.redrawExplore();
			this.redrawPins();
		}
		if (this.cullDirty) {
			const now = performance.now();
			// Culling correctness can lag a frame or two; don't let it eat
			// the budget on every single frame of a running simulation.
			if (now - this.lastCullAt >= CULL_MIN_INTERVAL_MS) {
				this.lastCullAt = now;
				this.cullDirty = false;
				this.cullAndLabel(); // may re-set cullDirty to finish deferred labels
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
		//
		// In 2D compare against the fit baseline, not the raw scale: a large
		// vault fits at a tiny absolute scale, so an absolute threshold above
		// ~1 would hide every label regardless of zoom. Relative to fit,
		// threshold 1 = "labels at the framed view", >1 = only when zoomed in.
		const depthGated = this.camera.enabled && this.depthScales !== null;
		const reference = this.viewport.referenceScale;
		const zoomRatio = reference > 0 ? scale / reference : scale;
		const showLabels = this.labelsVisible && (depthGated || zoomRatio >= this.labelZoomThreshold);
		const readable = !this.labelScaleWithZoom || this.labelFontSize * scale >= MIN_LABEL_SCREEN_PX;
		let labelBudget = showLabels && readable ? this.labelMaxCount : 0;
		let creationBudget = NEW_LABELS_PER_FRAME;
		let creationSkipped = false;
		const labeled = new Set<number>();

		/** Show node `i`'s label, respecting the per-frame creation budget.
		 *  Returns false when it had to be deferred to a later frame. */
		const takeLabel = (i: number): boolean => {
			if (!this.labels.has(i) && creationBudget <= 0) {
				creationSkipped = true;
				return false;
			}
			if (!this.labels.has(i)) creationBudget--;
			labeled.add(i);
			this.ensureLabel(i, this.positions![i * 2], this.positions![i * 2 + 1]);
			return true;
		};

		// Explore mode names the node you are on and everything you can travel
		// to, whatever the zoom threshold and the label budget say: those names
		// are the choice you are being asked to make, not decoration.
		if (this.explore) {
			for (const i of [this.explore.centerId, ...this.explore.neighbors]) {
				if (labeled.has(i)) continue;
				if (this.hiddenMask !== null && this.hiddenMask[i] === 1) continue;
				if (this.depthScales !== null && this.depthScales[i] === 0) continue;
				if (!isOnScreen(i)) continue;
				takeLabel(i);
			}
		}

		// …and nothing else gets named. A field of labels from notes you cannot
		// travel to reads as clutter over the two things that matter: where you
		// are and where you can go.
		if (this.explore) {
			for (const [i, label] of this.labels) {
				if (!labeled.has(i)) label.visible = false;
			}
			if (creationSkipped) this.cullDirty = true;
			return;
		}

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
				if (labeled.has(i)) continue;
				const hidden =
					(this.hiddenMask !== null && this.hiddenMask[i] === 1) ||
					(this.depthScales !== null && this.depthScales[i] === 0) ||
					(depthGated && this.depthScales![i] < this.labelZoomThreshold);
				// No node-size gate: priority order already favors important
				// nodes, and a small «Размер узлов» must not kill every label.
				if (hidden || !isOnScreen(i)) continue;
				if (takeLabel(i)) labelBudget--;
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
	/**
	 * The user switched theme (or installed one). Re-read every color that came
	 * from a CSS variable and drop the label cache, whose halo and fill were
	 * baked in at creation time — they are rebuilt on the next frame.
	 */
	refreshThemeColors(): void {
		this.colors = readThemeColors();
		this.labelHalo = cssColorToNumber(
			getComputedStyle(document.body).getPropertyValue("--background-primary").trim() || "#1e1e1e"
		);
		for (const label of this.labels.values()) label.destroy();
		this.labels.clear();
		this.edgeMesh?.setColor(this.colors.edge);
		this.positionsDirty = true;
		this.edgesDirty = true;
	}

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

		return pickNodeAt({
			positions: this.positions,
			radii: this.radii,
			pointerX: point.x,
			pointerY: point.y,
			hitRadius: HOVER_RADIUS_PX / this.viewport.scale,
			hiddenMask: this.hiddenMask,
			depthScales: this.depthScales,
		});
	}

	/** Node pressed but not yet moved past the drag threshold. */
	private pressedId: number | null = null;
	private pressedEvent: PointerEvent | null = null;
	/** Node under a pressed middle mouse button, resolved on release. */
	private middlePressedId: number | null = null;
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
			// Orbit around the scene center, not the camera's own axis.
			this.camera.orbit(
				(event.clientX - this.orbitLastX) * 0.005,
				(event.clientY - this.orbitLastY) * 0.005
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
			if (
				isDragGesture(
					this.pressedEvent.clientX,
					this.pressedEvent.clientY,
					event.clientX,
					event.clientY,
					DRAG_THRESHOLD_PX
				)
			) {
				this.draggingId = this.pressedId;
				if (this.viewport) this.viewport.suppressPan = true;
				this.callbacks.onNodeDragStart(this.draggingId);
				this.moveDraggedNode(event);
				return;
			}
		}
		if (this.explore) {
			// In explore mode the pointer aims down links instead of picking
			// nodes; running the hover pipeline too would fight the overlay for
			// which node looks selected.
			this.callbacks.onExploreAim(
				this.aimFromPointer(event.clientX, event.clientY),
				event.clientX,
				event.clientY
			);
			return;
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

	/** Which link the pointer is aiming down, in explore mode. */
	private aimFromPointer(clientX: number, clientY: number): number | null {
		const overlay = this.explore;
		if (!overlay || !this.app || !this.positions || !this.viewport) return null;
		const rect = this.app.canvas.getBoundingClientRect();
		const point = this.viewport.toWorld(clientX - rect.left, clientY - rect.top);

		return pickAimedNeighbor({
			positions: this.positions,
			centerId: overlay.centerId,
			neighbors: overlay.neighbors,
			pointerX: point.x,
			pointerY: point.y,
			deadZone: DEAD_ZONE_PX / this.viewport.scale,
			maxAngle: MAX_AIM_ANGLE,
			hiddenMask: this.hiddenMask,
			depthScales: this.depthScales,
		});
	}

	private moveDraggedNode(event: PointerEvent): void {
		if (this.draggingId === null || !this.app || !this.positions3 || !this.viewport) return;
		const rect = this.app.canvas.getBoundingClientRect();
		const point = this.viewport.toWorld(event.clientX - rect.left, event.clientY - rect.top);
		const id = this.draggingId;

		// Screen-plane dragging needs a fresh projection; without one fall back to
		// the flat path (pointer world position = node position).
		const projected = this.camera.enabled && this.depthScales && this.positions;
		const target = dragTargetPosition({
			camera: projected ? this.camera : null,
			current: {
				x: this.positions3[id * 3],
				y: this.positions3[id * 3 + 1],
				z: this.positions3[id * 3 + 2],
			},
			pointerWorldX: point.x,
			pointerWorldY: point.y,
			projectedX: this.positions ? this.positions[id * 2] : 0,
			projectedY: this.positions ? this.positions[id * 2 + 1] : 0,
			depthScale: this.depthScales ? this.depthScales[id] : 1,
		});
		// null = the node is behind the camera; keep its last good position
		// instead of writing Infinity into the layout.
		if (!target) return;

		this.positions3[id * 3] = target.x;
		this.positions3[id * 3 + 1] = target.y;
		this.positions3[id * 3 + 2] = target.z;
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
		if (event.button === 1) {
			// Middle button opens in a new tab; resolve on release so a
			// press-and-move doesn't count. preventDefault stops autoscroll.
			const middleId = this.findNodeAt(event.clientX, event.clientY);
			if (middleId !== null) {
				this.middlePressedId = middleId;
				event.preventDefault();
			}
			return;
		}
		if (event.button !== 0) return;
		if (this.explore) {
			// A click on an armed link skips the wait; a click on nothing still
			// orbits, so the view stays steerable without leaving the mode.
			if (this.explore.candidateId !== null) {
				// Suppress the pan the viewport would otherwise start: the
				// click means "go there", and sliding the picture at the same
				// time would fight the flight. Released on pointer-up.
				if (this.viewport) this.viewport.suppressPan = true;
				this.callbacks.onExploreJump();
				return;
			}
			this.startOrbit(event);
			return;
		}
		if (event.shiftKey) {
			this.startLasso(event);
			return;
		}
		const nodeId = this.findNodeAt(event.clientX, event.clientY);
		if (nodeId === null) {
			// Empty-area drag rotates the 3D view; hold Alt to pan instead.
			if (!event.altKey) this.startOrbit(event);
			return;
		}
		this.pressedId = nodeId;
		this.pressedEvent = event;
		// Block panning immediately: the press landed on a node, so this
		// gesture is either a click or a node drag, never a camera pan.
		if (this.viewport) this.viewport.suppressPan = true;
	};

	/** Begin an orbit drag; a no-op in flat mode, where there is nothing to
	 *  orbit around. */
	private startOrbit(event: PointerEvent): void {
		if (!this.camera.enabled) return;
		this.orbiting = true;
		this.orbitLastX = event.clientX;
		this.orbitLastY = event.clientY;
		if (this.viewport) this.viewport.suppressPan = true;
	}

	private handlePointerUp = (event: PointerEvent): void => {
		if (this.rmbPanning && event.button === 2) {
			this.rmbPanning = false;
			return;
		}
		if (event.button === 1) {
			if (
				this.middlePressedId !== null &&
				this.findNodeAt(event.clientX, event.clientY) === this.middlePressedId
			) {
				this.callbacks.onNodeMiddleClick(this.middlePressedId);
			}
			this.middlePressedId = null;
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
