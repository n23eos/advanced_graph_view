import { edgeColor, edgeWorldWidth } from "./edgeAppearance";
import { renderResolution } from "../settings/renderResolution";
import type { RenderScale } from "../settings/schema";
import type { CameraState } from "../view/workspaceState";
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
import { ClickDispatcher } from "./clickDispatcher";
import { createEdgePathView, EdgeMesh } from "./EdgeMesh";
import { DEAD_ZONE_PX, MAX_AIM_ANGLE, pickAimedNeighbor } from "../explore/aiming";
import { HOVER_RADIUS_PX, pickNodeAt } from "./hitTest";
import {
	emphasisBoost,
	fogFactor,
	labelDepthAlpha,
	mergeHiddenMask,
	nodeAlpha,
	pinRingRadius,
	sizeDepth,
	zoomSizeCompensation,
	degreeRadius,
	MAX_NODE_RADIUS,
} from "./nodeAppearance";
import { NodeTextureCache, nodeCoreRatio, STAR_SIZE_FACTOR } from "./NodeTexture";
import type { NodeStyle } from "./nodeStyle";
import { LabelCollisionGrid, overlapsAny, type LabelBox } from "./labelCollision";
import { placeLabelCandidates, selectLabelCandidates, type LabelId, type LabelLayoutCandidate, type LabelRole } from "./labelLayout";
import { groupGraphFolders } from "./folderLabels";
import { categoryColor } from "../encoding/colorScales";
import { adaptColorToTheme } from "../encoding/themeContrast";
import { isLightTheme } from "./theme";
import { SMOOTH_FACTOR, easePositions } from "./positionSmoothing";
import { Camera3D } from "./projection";
import { Viewport } from "./Viewport";
import { isMeaningfulResize } from "./resizeGate";
import { motionMs, prefersReducedMotion } from "./motion";
import { LabelOverlay, type OverlayLabel } from "./LabelOverlay";
import {
	edgePulsePhase,
	pulseDelay,
	selectPulseEdges,
	slicePackedPath,
} from "./edgePulse";

const DEFAULT_LABEL_ZOOM_THRESHOLD = 0.9;
const DEFAULT_LABEL_FONT_SIZE = 11;
const LABEL_COUNT_LIMIT = 150;
const TINY_NODE_CULL_PX = 0.35; // nodes smaller than this on screen are skipped
/** Host-size changes smaller than this are noise, not a real pane resize. */
const EDGE_ALPHA = 0.25;
const OVERVIEW_EDGE_ALPHA_FACTOR = 0.36;
const HOVER_EDGE_LIMIT = 120;
const HOVER_EDGE_FADE_MS = 180;
const HOVER_EDGE_WIDTH_PX = 1.85;
const HOVER_BACKGROUND_EDGE_ALPHA = 0.34;
const HOVER_FOCUS_FADE_MS = 160;
const FOLDER_COLORS = [0x508bd7, 0x53bba7, 0xaf79d2, 0xe0a456, 0x72a95d];
// Text rasterization is expensive; creating many labels in one frame causes
// visible hitches during panning, so budget creations per frame.
const NEW_LABELS_PER_FRAME = 4;
const RENDER_ON_DEMAND = true;
const MAX_IDLE_RENDER_MS = 500;
const CULL_MIN_INTERVAL_MS = 30;
const MIN_LABEL_SCREEN_PX = 8;
const HULL_FILL_ALPHA = 0.1;
const HULL_PADDING = 18;
/** Starting 3D orientation, shared by the 2D→3D toggle and Reset camera. */
const DEFAULT_3D_YAW = 0.5;
const DEFAULT_3D_PITCH = -0.3;
/** Pin rings: present enough to spot, quiet enough not to compete with nodes. */
const PIN_RING_ALPHA = 0.8;
const PIN_RING_WIDTH = 1.2;
// Explore mode draws its own links on top of the edge mesh: travellable links
// brighter than the graph behind them, the armed one brighter still.
const EXPLORE_LINK_ALPHA = 0.45;
const EXPLORE_LINK_WIDTH = 1.2;
const EXPLORE_CANDIDATE_ALPHA = 1;
const EXPLORE_CANDIDATE_WIDTH = 3.5;
/** Path tool: a thin violet thread. Fixed hue, not the theme accent — the
 *  route has to stay recognizable on every color scheme and both themes. */
const PATH_LINK_COLOR = 0x7c3aed;
const PATH_LINK_WIDTH = 1.2;
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
	onCameraChanged?(): void;
	onNodePreview?(nodeId: number | null, event: PointerEvent): void;
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

interface EdgePulseBatch {
	origin: number;
	startedAt: number;
	edgeIndices: number[];
}

/** Resolved inside `parent`, so container-scoped variable overrides (the
 *  graph's own light/dark theme) win over the Obsidian body theme. */
function cssColorToNumber(value: string, parent: HTMLElement, ownerWindow: Window): number {
	const probe = parent.createDiv();
	probe.style.color = value;
	const rgb = ownerWindow.getComputedStyle(probe).color.match(/\d+/g);
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
	// Head sits at 65% of the segment so it stays visible outside node circles.
	const hx = x1 + (x2 - x1) * 0.65;
	const hy = y1 + (y2 - y1) * 0.65;
	drawArrowTip(g, hx, hy, x2 - x1, y2 - y1, color, alpha);
}

function drawArrowTip(
	g: Graphics, hx: number, hy: number, dx: number, dy: number, color: number, alpha: number
): void {
	const angle = Math.atan2(dy, dx);
	const size = 6;
	g.moveTo(hx, hy);
	g.lineTo(hx - size * Math.cos(angle - 0.4), hy - size * Math.sin(angle - 0.4));
	g.moveTo(hx, hy);
	g.lineTo(hx - size * Math.cos(angle + 0.4), hy - size * Math.sin(angle + 0.4));
	g.stroke({ color, alpha, width: 1.5 });
}

function readThemeColors(host: HTMLElement, ownerWindow: Window): ThemeColors {
	const styles = ownerWindow.getComputedStyle(host);
	const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
	return {
		node: cssColorToNumber(read("--graph-node", "var(--text-muted)"), host, ownerWindow),
		nodeSelected: cssColorToNumber(read("--interactive-accent", "#7c3aed"), host, ownerWindow),
		edge: cssColorToNumber(read("--graph-line", "var(--background-modifier-border)"), host, ownerWindow),
		label: cssColorToNumber(read("--text-normal", isLightTheme(host.ownerDocument) ? "#1f2937" : "#f4f4f5"),
			host, ownerWindow),
	};
}

/**
 * Pixi scene: node sprites in one batch, edges in a single Graphics that is
 * re-stroked only when positions change, labels created lazily above the
 * zoom threshold, viewport culling on every camera change.
 */
export class GraphRenderer {
	private app: Application | null = null;
	private destroyed = false;
	private paused = false;
	private needsRender = true;
	private lastRenderAt = -Infinity;
	private _ownerWindow: Window | null = null;
	private frame: number | null = null;
	private frameGeneration = 0;
	private frameNow = () => performance.now();
	private world = new Container();
	private edgeMesh: EdgeMesh | null = null;
	private readonly edgePath = createEdgePathView();
	private hullGraphics = new Graphics();
	private hoverEdgeGraphics = new Graphics();
	private hoverNodeGraphics = new Graphics();
	private edgePulseGraphics = new Graphics();
	private incidentEdges: number[][] = [];
	private highlightedEdgeNode: number | null = null;
	private hoverEdgeOpacity = 0;
	private hoverEdgeFrameAt = 0;
	private hoverFocus = 0;
	private hoverFocusFrameAt = 0;
	private edgePulseBatch: EdgePulseBatch | null = null;
	private readonly edgePulseScratch: number[] = [];
	private trailGraphics = new Graphics();
	private trailNodeIds: number[] = [];
	private trailProgress = 1;
	private exploreGraphics = new Graphics();
	private explore: ExploreOverlay | null = null;
	private presentationLinks: number | null = null;
	private pathGraphics = new Graphics();
	/** Node chain of the current "shortest path" pick, in order. */
	private pathNodeIds: number[] = [];
	private pinGraphics = new Graphics();
	private pinnedIds: ReadonlySet<number> = new Set();
	private nodeLayer = new Container();
	private labelLayer = new Container();
	private labelOverlay: LabelOverlay | null = null;
	private sprites: Sprite[] = [];
	private labels = new Map<number, Text>();
	private folderLabels = new Map<string, Text>();
	private folderGraphics = new Graphics();
	private folders: ReturnType<typeof groupGraphFolders> = [];
	private labelGrid = new LabelCollisionGrid();
	private labelFades = new Map<LabelId, { label: Text; target: number; placement: number }>();
	private labelClock = 0;
	private fittedCameraDistance = 0;
	private searchLabelIds: readonly number[] = [];
	private labelImportance: Float32Array | null = null;
	private modernLabelOrder: number[] = [];
	private labelHubCount = 8;
	private hoverOnlyLabels = false;
	private labelFadeMs = 180;
	private folderLabelsEnabled = true;
	private folderMode: "top" | "parent" = "top";
	private folderColors: Readonly<Record<string, string>> = {};
	private glowIntensity = 1;
	private nodeTextureCache: NodeTextureCache | null = null;
	private colorScheme = "recency";
	private nodeTexture: Texture | null = null;
	/** Wide-halo variant used by the glow ("galaxy") color schemes. */
	private starTexture: Texture | null = null;
	private ringTexture: Texture | null = null;
	private nodeStyle: NodeStyle = "flat";
	/** Sprite size multiplier compensating the star texture's smaller core. */
	private spriteScale = 1;
	/** Largest radius the last encoding produced; drives the cull margin. */
	private maxEncodedRadius = MAX_NODE_RADIUS;
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
	private edgeZoom = 1;
	private edgeOpacity = EDGE_ALPHA;
	private edgesVisible = true;
	private modernAppearance = false;
	private preferCoreHitRadius = false;
	private overviewStyle = false;
	private backdrop: number | null = null;
	private edgeCurvature = 0.13;
	/** Halo color behind label glyphs — theme background for contrast. */
	private labelHalo = 0x000000;

	private model: GraphModel | null = null;
	/** Raw xyz world positions (stride 3), eased toward the worker's latest
	 *  frame — this is what actually gets drawn. */
	private positions3: Float32Array | null = null;
	/** The worker's latest frame; `positions3` chases it every rendered frame. */
	private targetPositions3: Float32Array | null = null;
	/** true while `positions3` is still short of `targetPositions3`. */
	private smoothing = false;
	/** false until the first worker frame lands, so a fresh model snaps into
	 *  place instead of blooming out of the origin. */
	private hasWorkerFrame = false;
	/** Static z override (cluster/age depth modes); null = physics z. */
	private depthOverride: Float32Array | null = null;
	/** Per-node perspective scale from the last projection. */
	private depthScales: Float32Array | null = null;
	readonly camera = new Camera3D();
	/** Projected 2D screen-space coordinates — the rest of the pipeline
	 *  (sprites, edges, culling, hit tests, hulls) only ever sees these. */
	private positions: Float32Array | null = null;
	private radii: Float32Array | null = null;
	private projectedCoreRadii = new Float32Array(0);
	private positionsDirty = false;
	private edgesDirty = false;
	private cullDirty = false;
	private hoveredId: number | null = null;
	/** Neighbors of the hovered node (undirected), for hover emphasis. */
	private hoverNeighbors = new Set<number>();
	private selectedId: number | null = null;
	/** Set once the GPU context is gone; every draw call after that is a no-op. */
	private contextLost = false;
	private readonly handleContextLost = (event: Event): void => {
		if (this.destroyed || this.app === null) return;
		event.preventDefault();
		this.contextLost = true;
		this.stopFrames();
		console.error("Advanced Graph View: WebGL context lost");
		this.callbacks.onContextLost();
	};
	/** The element the canvas lives in; theme colors are resolved against it. */
	private host: HTMLElement | null = null;

	constructor(private readonly callbacks: RendererCallbacks) {}

	/** The window that owns this renderer, retained until it is destroyed. */
	get ownerWindow(): Window {
		if (!this._ownerWindow) throw new Error("Graph renderer has no document window");
		return this._ownerWindow;
	}

	getCameraState(): CameraState | null {
		if (!this.app || !this.viewport) return null;
		const { width, height } = this.app.screen;
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
		return {
			viewport: this.viewport.getState(width, height),
			camera3d: {
				position: { x: this.camera.px, y: this.camera.py, z: this.camera.pz },
				pivot: { x: this.camera.tx, y: this.camera.ty, z: this.camera.tz },
				yaw: this.camera.yaw,
				pitch: this.camera.pitch,
			},
		};
	}

	restoreCameraState(state: CameraState): void {
		if (!this.app || !this.viewport) return;
		if (!this.camera.enabled) {
			this.viewport.restoreState(state.viewport, this.app.screen.width, this.app.screen.height);
		}
		this.camera.px = state.camera3d.position.x;
		this.camera.py = state.camera3d.position.y;
		this.camera.pz = state.camera3d.position.z;
		this.camera.tx = state.camera3d.pivot.x;
		this.camera.ty = state.camera3d.pivot.y;
		this.camera.tz = state.camera3d.pivot.z;
		this.camera.yaw = state.camera3d.yaw;
		this.camera.pitch = state.camera3d.pitch;
		this.invalidate();
		this.cullDirty = true;
		this.reproject();
	}

	previewNodeAt(clientX: number, clientY: number): number | null {
		const rect = this.app?.canvas.getBoundingClientRect();
		if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
		return this.findNodeAt(clientX, clientY);
	}

	get canvasElement(): HTMLCanvasElement | null {
		return this.app?.canvas ?? null;
	}

	async init(host: HTMLElement, renderScale: RenderScale = "standard"): Promise<void> {
		const ownerWindow = host.ownerDocument.defaultView;
		if (!ownerWindow) throw new Error("Graph renderer requires a document window");
		this._ownerWindow = ownerWindow;
		this.frameNow = () => ownerWindow.performance.now();
		this.host = host;
		const canvas = ownerWindow.createEl("canvas", { cls: "graph-insight-scene" });
		const app = new Application();
		try {
			await app.init({
				...renderResolution(renderScale, ownerWindow.devicePixelRatio),
				canvas,
				width: Math.max(host.clientWidth, 1),
				height: Math.max(host.clientHeight, 1),
				autoStart: false,
				antialias: false, // MSAA on 30k edge lines costs several ms/frame; glow sprites hide the aliasing
				backgroundAlpha: 0,
				// DOM overlays can repaint between on-demand WebGL draws.
				preserveDrawingBuffer: true,
				// An array is an allowlist in Pixi 8. A string is only a preference
				// and silently falls back to Canvas, which cannot render EdgeMesh.
				preference: ["webgl"],
			});
		} catch (error) {
			this.host = null;
			try {
				if (app.renderer) app.destroy({ removeView: true }, { children: true, texture: true });
				else app.stage.destroy({ children: true, texture: true });
			} catch (cleanupError) {
				console.error("Advanced Graph View: failed to clean up renderer startup", cleanupError);
			}
			throw error;
		}
		if (this.destroyed) {
			this.host = null;
			app.destroy({ removeView: true }, { children: true, texture: true });
			return;
		}
		this.app = app;
		host.appendChild(app.canvas);
		// Without preventDefault the browser will not even try to hand the
		// context back. Pixi cannot rebuild its GPU resources on its own, so the
		// view is told to start over rather than left with a blank canvas.
		app.canvas.addEventListener("webglcontextlost", this.handleContextLost);

		this.colors = readThemeColors(host, ownerWindow);
		if (this.overviewStyle) this.syncOverviewStyle();
		this.labelHalo = cssColorToNumber(
			ownerWindow.getComputedStyle(host).getPropertyValue("--background-primary").trim() || "#1e1e1e",
			host,
			ownerWindow
		);
		this.nodeTextureCache = new NodeTextureCache(app.renderer);
		this.refreshNodeTextures();
		this.world.addChild(
			this.hullGraphics,
			this.folderGraphics,
			this.hoverEdgeGraphics,
			this.edgePulseGraphics,
			this.nodeLayer,
			this.hoverNodeGraphics,
			this.pinGraphics,
			this.labelLayer,
			this.trailGraphics,
			this.pathGraphics,
			this.exploreGraphics
		);
		app.stage.addChild(this.world);
		this.world.position.set(host.clientWidth / 2, host.clientHeight / 2);

		this.viewport = new Viewport(this.world, app.canvas, () => this.handleViewportChanged());

		this.world.addChild(this.lassoGraphics);
		// In 3D, the wheel dollies the camera through the cloud (fly-through)
		// instead of scaling the flat picture. Capture phase so the 2D zoom
		// in Viewport never sees the event.
		app.canvas.addEventListener(
			"wheel",
			this.handleWheel,
			{ capture: true, passive: false }
		);
		app.canvas.addEventListener("pointerdown", this.handlePointerDown);
		app.canvas.addEventListener("contextmenu", this.handleContextMenu);
		// Move/up live on window so a drag keeps tracking outside the canvas.
		ownerWindow.addEventListener("pointermove", this.handlePointerMove);
		ownerWindow.addEventListener("pointerup", this.handlePointerUp);
		ownerWindow.addEventListener("resize", this.handleWindowResize);

		// TickerPlugin registers this exact function/context pair in Pixi 8.
		// Keep the ticker for scene updates, but own the decision to draw.
		// eslint-disable-next-line @typescript-eslint/unbound-method -- The explicit app context matches Pixi's registration.
		app.ticker.remove(app.render, app);
		app.ticker.add(() => this.renderFrame());
		this.scheduleFrame();
	}

	private scheduleFrame(): void {
		if (!this.app || !this._ownerWindow || this.destroyed || this.contextLost || this.paused || this.frame !== null) return;
		const generation = this.frameGeneration;
		this.frame = this._ownerWindow.requestAnimationFrame((timestamp) => {
			if (generation !== this.frameGeneration) return;
			this.frame = null;
			if (!this.app || this.destroyed || this.contextLost || this.paused) return;
			this.app.ticker.update(timestamp);
			this.scheduleFrame();
		});
	}

	private stopFrames(): void {
		this.frameGeneration++;
		if (this.frame !== null) this._ownerWindow?.cancelAnimationFrame(this.frame);
		this.frame = null;
	}

	private readonly handleWindowResize = (): void => this.resize();
	private handleViewportChanged(): void {
		this.cullDirty = true;
		this.invalidate();
		this.callbacks.onCameraChanged?.();
	}

	private readonly handleWheel = (event: WheelEvent): void => {
		if (!this.camera.enabled) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		this.camera.fly(-event.deltaY * 1.5);
		this.reproject();
		this.callbacks.onCameraChanged?.();
	};

	pause(): void {
		if (this.destroyed) return;
		this.paused = true;
		this.stopFrames();
		this.clearEdgePulses(false);
		// Persist the latest worker frame even if smoothing had not reached it
		// when the pane was hidden. Projection can wait until the pane returns.
		if (this.smoothing && this.targetPositions3) {
			this.positions3 = new Float32Array(this.targetPositions3);
			this.smoothing = false;
		}
		this.app?.ticker.stop();
	}

	resume(): void {
		if (this.destroyed || this.contextLost) return;
		this.invalidate();
		const wasPaused = this.paused;
		this.paused = false;
		if (wasPaused) this.reproject();
		this.scheduleFrame();
	}

	setModel(model: GraphModel): void {
		if (!this.app || !this.nodeTexture || !this.colors) return;
		this.invalidate();
		this.model = model;
		this.encodedTints = null;
		this.clearModernLabels();
		this.fittedCameraDistance = 0;
		this.folders = this.modernAppearance ? groupGraphFolders(model.nodes, this.folderMode) : [];
		this.searchLabelIds = [];
		this.labelImportance = null;
		this.rebuildModernLabelOrder();
		this.incidentEdges = Array.from({ length: model.nodes.length }, () => []);
		this.hoveredId = null;
		this.hoverNeighbors.clear();
		this.resetHoverFocus();
		this.clearEdgePulses(false);
		this.positions3 = new Float32Array(model.nodes.length * 3);
		this.targetPositions3 = null;
		this.smoothing = false;
		this.hasWorkerFrame = false;
		this.positions = new Float32Array(model.nodes.length * 2);
		this.depthScales = new Float32Array(model.nodes.length);
		this.radii = new Float32Array(model.nodes.length);
		this.projectedCoreRadii = new Float32Array(model.nodes.length);

		for (let i = 0; i < model.edges.length; i++) {
			const { source, target } = model.edges[i];
			this.incidentEdges[source].push(i);
			if (source !== target) this.incidentEdges[target].push(i);
		}
		this.rebuildEdgeMesh();

		this.nodeLayer.removeChildren();
		for (const label of this.labels.values()) label.destroy();
		this.labels.clear();
		this.sprites = [];

		for (const node of model.nodes) {
			const radius = degreeRadius(node.inCount + node.outCount);
			this.radii[node.id] = radius;

			const sprite = new Sprite(this.textureForStyle(this.nodeStyle));
			sprite.anchor.set(0.5);
			sprite.tint = this.colors.node;
			if (this.nodeStyle === "glow") sprite.blendMode = "add";
			sprite.setSize(radius * 2 * this.spriteScale);
			this.sprites.push(sprite);
			this.projectedCoreRadii[node.id] = radius * this.spriteScale * nodeCoreRatio(this.nodeStyle);
			this.nodeLayer.addChild(sprite);
		}
		this.rebuildLabelPriority();
		this.edgesDirty = true;
		this.cullDirty = true;
	}

	private rebuildEdgeMesh(): void {
		if (!this.colors || !this.model) return;
		this.edgeMesh?.destroy();
		const pairs = new Uint32Array(this.model.edges.length * 2);
		for (let i = 0; i < this.model.edges.length; i++) {
			const edge = this.model.edges[i];
			pairs[i * 2] = edge.source;
			pairs[i * 2 + 1] = edge.target;
		}
		this.edgeMesh = new EdgeMesh(pairs, this.colors.edge, this.effectiveEdgeAlpha(), this.modernAppearance
			? { curvature: this.edgeCurvature, segments: 3, nodeKeys: this.model.nodes.map((node) => node.path) }
			: undefined);
		this.syncEdgePalette();
		this.edgeMesh.setVisible(this.edgesVisible);
		this.world.addChildAt(this.edgeMesh.mesh, 1);
		this.syncEdgeVisibility();
	}

	/** New xyz frame from the layout worker (stride 3). It becomes the target
	 *  the drawn positions ease toward; see `positionSmoothing`. */
	updatePositions(positions3: Float32Array): void {
		this.invalidate();
		// While a drag is active the local pointer position is fresher than the
		// worker frame (the worker echoes the previous drag-move), so keep the
		// local coords — otherwise the grabbed node rubber-bands behind the
		// cursor as stale frames overwrite it. Copying them into the target too
		// leaves the grabbed node with a zero gap, so easing never tugs it back.
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
		this.targetPositions3 = positions3;

		// Hidden panes adopt the frame so persistence and auto-fit stay current.
		// First frame of a model, or a node-count change: adopt it outright.
		// Easing from a zeroed array would explode the graph out of the origin
		// and hand `fitAll` a knot to frame.
		if (
			this.paused ||
			!this.hasWorkerFrame ||
			!this.positions3 ||
			this.positions3.length !== positions3.length
		) {
			this.positions3 = new Float32Array(positions3);
			if (this.modernAppearance && this.fittedCameraDistance === 0 && positions3.length > 0) {
				this.fittedCameraDistance = this.cloudBounds().distance;
			}
			this.hasWorkerFrame = true;
			this.smoothing = false;
			this.reproject();
			return;
		}

		this.smoothing = true;
	}

	/** Re-run the camera projection into the 2D pipeline arrays. */
	private reproject(): void {
		if (!this.positions3) return;
		this.invalidate();
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
		this.invalidate();
		const turningOn = enabled && !this.camera.enabled;
		this.camera.enabled = enabled;
		if (turningOn) {
			this.camera.yaw = DEFAULT_3D_YAW;
			this.camera.pitch = DEFAULT_3D_PITCH;
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

	/** Deterministic home view (F-06): in 3D the orbit returns to the same
	 *  orientation the 2D→3D toggle starts with, then the whole graph is
	 *  framed — which also rebuilds pan and zoom from scratch in 2D. */
	resetCamera(): void {
		this.invalidate();
		if (this.camera.enabled) {
			this.camera.yaw = DEFAULT_3D_YAW;
			this.camera.pitch = DEFAULT_3D_PITCH;
		}
		this.fitAll();
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
		const { cx, cy, cz, distance } = this.cloudBounds();
		const [fx, fy, fz] = this.camera.forward();
		this.fittedCameraDistance = distance;
		this.camera.px = cx - fx * distance;
		this.camera.py = cy - fy * distance;
		this.camera.pz = cz - fz * distance;
		this.camera.tx = cx;
		this.camera.ty = cy;
		this.camera.tz = cz;
	}

	private cloudBounds(): { cx: number; cy: number; cz: number; distance: number } {
		let cx = 0, cy = 0, cz = 0;
		const positions = this.positions3;
		if (!positions?.length) return { cx, cy, cz, distance: 1 };
		const count = positions.length / 3;
		for (let i = 0; i < count; i++) {
			cx += positions[i * 3];
			cy += positions[i * 3 + 1];
			cz += positions[i * 3 + 2];
		}
		cx /= count; cy /= count; cz /= count;
		let radius = 1;
		for (let i = 0; i < count; i++) {
			const d = Math.hypot(
				positions[i * 3] - cx,
				positions[i * 3 + 1] - cy,
				positions[i * 3 + 2] - cz
			);
			if (d > radius) radius = d;
		}
		return { cx, cy, cz, distance: radius * 1.6 };
	}

	/** Fit every visible node into the viewport. */
	fitAll(): void {
		this.invalidate();
		if (!this.positions || !this.radii) return;
		if (this.camera.enabled && this.positions3) {
			// 3D: fly the camera back to где всё облако в кадре — fitting the
			// 2D projection would chase coordinates that move with the camera.
			this.frameCloud();
			this.reproject();
			this.callbacks.onCameraChanged?.();
			return;
		}
		const ids: number[] = [];
		for (let i = 0; i < this.radii.length; i++) {
			if (this.hiddenMask === null || this.hiddenMask[i] === 0) ids.push(i);
		}
		this.zoomToNodes(ids);
	}

	/** Resize from the host pane, without Pixi's global-window ResizePlugin. */
	resize(): void {
		if (!this.app || !this.host) return;
		const host = this.host;
		if (
			!isMeaningfulResize(
				host.clientWidth,
				host.clientHeight,
				this.app.screen.width,
				this.app.screen.height
			)
		) {
			return;
		}
		const viewportState = !this.camera.enabled && this.viewport
			? this.viewport.getState(this.app.screen.width, this.app.screen.height)
			: null;
		this.invalidate();
		this.app.renderer.resize(host.clientWidth, host.clientHeight);
		if (this.camera.enabled && this.viewport) {
			this.world.scale.set(1);
			this.viewport.centerOn(0, 0, this.app.canvas.clientWidth, this.app.canvas.clientHeight);
		} else if (viewportState && this.viewport) {
			this.viewport.restoreState(viewportState, host.clientWidth, host.clientHeight);
		}
		this.cullDirty = true;
	}

	setCameraFocal(focal: number): void {
		this.invalidate();
		this.camera.focal = focal;
		if (this.camera.enabled) this.reproject();
	}

	setDepthOverride(depths: Float32Array | null): void {
		this.invalidate();
		this.depthOverride = depths;
		this.reproject();
	}

	setSelected(nodeId: number | null): void {
		this.invalidate();
		this.cullDirty = true;
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
		this.invalidate();
		if (this.encodedTints !== tints) {
			this.encodedTints = tints;
			this.syncEdgePalette();
		}
		this.encodedGlow = glow;
		let maxRadius = 0;
		for (let i = 0; i < this.sprites.length; i++) {
			this.radii[i] = sizes[i];
			if (sizes[i] > maxRadius) maxRadius = sizes[i];
			this.sprites[i].setSize(sizes[i] * 2 * this.spriteScale);
		}
		// The node-size slider scales radii well past MAX_NODE_RADIUS, and the
		// cull margin has to keep up or big nodes blink out at the view edge.
		this.maxEncodedRadius = maxRadius;
		this.applyNodeTints();
		this.applyNodeAlpha();
		this.applyHoverSize();
		this.rebuildLabelPriority();
		this.cullDirty = true;
	}

	setDimMask(mask: Uint8Array | null): void {
		this.invalidate();
		this.dimMask = mask;
		this.applyNodeAlpha();
	}

	/** Per-node alpha multiplier (search dim, focus falloff); null = off. */
	private alphaFactors: Float32Array | null = null;
	/** 1 = search match — tinted with the accent color so matches pop. */
	private highlightMask: Uint8Array | null = null;

	setHighlightMask(mask: Uint8Array | null): void {
		this.invalidate();
		this.highlightMask = mask;
		this.applyNodeTints();
		this.applyHoverSize();
	}

	setAlphaFactors(factors: Float32Array | null): void {
		this.invalidate();
		this.alphaFactors = factors;
		this.applyNodeAlpha();
	}

	setHiddenMask(mask: Uint8Array | null): void {
		this.invalidate();
		this.hiddenMask = mask;
		this.syncEdgeVisibility();
		if (this.positions) {
			this.updateEdgeGeometry();
			this.edgesDirty = true;
		}
		this.cullDirty = true;
	}

	private updateEdgeGeometry(): void {
		if (!this.positions) return;
		const depth = this.camera.enabled ? this.depthScales : null;
		const world = this.modernAppearance && this.camera.enabled && this.positions3
			? { positions3d: this.positions3, projector: this.camera, zOverride: this.depthOverride }
			: undefined;
		this.edgeMesh?.setWidth(this.effectiveEdgeWidth());
		this.edgeMesh?.updatePositions(this.positions, depth, world);
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

	/** Final sprite diameter for one node: base size, depth, hover/highlight
	 *  boost, and in 2D the zoom floor that keeps far-out nodes visible. */
	private spriteDiameter(i: number, depth: number, boost: number): number {
		const base = (this.radii?.[i] ?? 0) * 2 * sizeDepth(depth) * boost * this.spriteScale;
		if (this.camera.enabled || !this.viewport) return base;
		return base * zoomSizeCompensation(base, this.viewport.scale);
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
			this.setNodeDiameter(i, depth, boost);
		}
		if (this.hoveredId !== null) {
			// zIndex only matters when the layer is sorted (3D mode).
			this.sprites[this.hoveredId].zIndex = Number.MAX_SAFE_INTEGER;
		}
	}

	private setNodeDiameter(id: number, depth: number, boost: number): void {
		const diameter = this.spriteDiameter(id, depth, boost);
		this.sprites[id].setSize(diameter);
		this.projectedCoreRadii[id] = diameter * 0.5 * nodeCoreRatio(this.nodeStyle);
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
				hoverFocus: this.hoverFocus,
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
		this.invalidate();
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
		this.invalidate();
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

	/** The chain found by the path tool, in order. Null clears it. */
	setPathHighlight(nodeIds: readonly number[] | null): void {
		this.invalidate();
		this.pathNodeIds = nodeIds ? [...nodeIds] : [];
		this.redrawPath();
		// The route names its own notes, so the label pass has to run again.
		this.cullDirty = true;
	}

	/**
	 * Draw the links the path actually travels, not just its notes. Two lit
	 * nodes leave the route between them to guesswork on a dense graph — the
	 * line is the answer, so it is drawn like the armed link in explore mode.
	 */
	private redrawPath(): void {
		const g = this.pathGraphics;
		g.clear();
		const ids = this.pathNodeIds;
		if (ids.length < 2 || !this.positions || !this.colors) return;
		for (let i = 0; i < ids.length - 1; i++) {
			if (this.modernAppearance) {
				if (!this.edgeMesh?.findEdgePath(ids[i], ids[i + 1], this.edgePath)) continue;
				this.traceEdge(g);
				g.stroke({ color: PATH_LINK_COLOR, alpha: 1, width: PATH_LINK_WIDTH });
				this.drawCurveArrow(g, PATH_LINK_COLOR, 1);
				continue;
			}
			const x1 = this.positions[ids[i] * 2];
			const y1 = this.positions[ids[i] * 2 + 1];
			const x2 = this.positions[ids[i + 1] * 2];
			const y2 = this.positions[ids[i + 1] * 2 + 1];
			g.moveTo(x1, y1);
			g.lineTo(x2, y2);
			g.stroke({ color: PATH_LINK_COLOR, alpha: 1, width: PATH_LINK_WIDTH });
			// Arrows read the chain in order: which note leads to which.
			drawArrowHead(g, x1, y1, x2, y2, PATH_LINK_COLOR, 1);
		}
	}

	/** Nodes the user has pinned in place. Drawn as rings so a pin is visible
	 *  without a tooltip — otherwise a node that ignores physics looks broken. */
	setPinned(ids: ReadonlySet<number>): void {
		this.invalidate();
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
		const previous = this.explore;
		if (previous === null && overlay === null) return;
		if (previous && overlay &&
			previous.centerId === overlay.centerId &&
			previous.candidateId === overlay.candidateId &&
			previous.neighbors.length === overlay.neighbors.length &&
			previous.neighbors.every((id, index) => id === overlay.neighbors[index])) return;
		this.invalidate();
		this.cullDirty = true;
		const wasExploring = this.explore !== null;
		if (overlay) this.resetHoverFocus();
		this.explore = overlay ? { ...overlay, neighbors: [...overlay.neighbors] } : null;
		// The rest of the vault's links are the loudest thing on screen once
		// the nodes are dimmed, so fade the whole edge mesh while the mode
		// draws its own links on top of it.
		if (wasExploring !== (overlay !== null)) {
			this.edgeMesh?.setAlpha(this.effectiveEdgeAlpha());
		}
		// Explore owns node emphasis even though hit testing still drives the
		// tooltip and direct clicks. Clear the old normal-mode hover styling.
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
		this.invalidate();
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

	isPresentationNodeVisible(id: number): boolean {
		return Number.isInteger(id) && id >= 0 && id < (this.model?.nodes.length ?? 0)
			&& this.hiddenMask?.[id] !== 1 && this.nodePosition(id) !== null;
	}

	orbitPresentation(pivot: { x: number; y: number; z: number }, radius: number, yaw: number, pitch: number): void {
		this.camera.yaw = yaw;
		this.camera.pitch = pitch;
		const [x, y, z] = this.camera.forward();
		this.placeCamera({ x: pivot.x - x * radius, y: pivot.y - y * radius, z: pivot.z - z * radius }, pivot);
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
		this.invalidate();
		this.camera.px = position.x;
		this.camera.py = position.y;
		this.camera.pz = position.z;
		this.camera.tx = pivot.x;
		this.camera.ty = pivot.y;
		this.camera.tz = pivot.z;
		this.reproject();
		this.callbacks.onCameraChanged?.();
	}

	setPresentationLinks(emphasis: number | null): void {
		if (this.presentationLinks === emphasis) return;
		if (this.presentationLinks === null && emphasis !== null) this.resetHoverFocus();
		this.presentationLinks = emphasis;
		this.exploreGraphics.alpha = emphasis ?? 1;
		this.edgeMesh?.setAlpha(this.effectiveEdgeAlpha());
		this.invalidate();
	}

	playPresentationPulse(id: number | null, neighbors?: readonly number[]): void {
		this.startEdgePulses(id, neighbors);
	}

	private redrawExplore(): void {
		const g = this.exploreGraphics;
		g.clear();
		const overlay = this.explore;
		if (!overlay || !this.positions || !this.colors ||
			(this.presentationLinks !== null && !this.edgesVisible)) return;

		const centerX = this.positions[overlay.centerId * 2];
		const centerY = this.positions[overlay.centerId * 2 + 1];

		for (const id of overlay.neighbors) {
			if (this.hiddenMask !== null && this.hiddenMask[id] === 1) continue;
			if (this.depthScales !== null && this.depthScales[id] === 0) continue;
			const x = this.positions[id * 2];
			const y = this.positions[id * 2 + 1];
			const isCandidate = id === overlay.candidateId;

			if (this.modernAppearance) {
				if (!this.edgeMesh?.findEdgePath(overlay.centerId, id, this.edgePath)) continue;
				this.traceEdge(g);
			} else {
				g.moveTo(centerX, centerY);
				g.lineTo(x, y);
			}
			const presentation = this.presentationLinks !== null;
			const color = presentation ? edgeColor(
				this.encodedTints?.[overlay.centerId] ?? -1, this.encodedTints?.[id] ?? -1,
				this.colors.nodeSelected, this.colors.label
			) : isCandidate ? this.colors.nodeSelected : this.colors.edge;
			g.stroke({
				color,
				alpha: presentation ? 0.78 : isCandidate ? EXPLORE_CANDIDATE_ALPHA : EXPLORE_LINK_ALPHA,
				width: isCandidate ? EXPLORE_CANDIDATE_WIDTH : EXPLORE_LINK_WIDTH,
			});

			// An arrow on the aimed link says which way the trip would go —
			// with two notes lit up, the direction is the missing half.
			if (isCandidate) {
				if (this.modernAppearance) this.drawCurveArrow(g, this.colors.nodeSelected, 1);
				else drawArrowHead(g, centerX, centerY, x, y, this.colors.nodeSelected, 1);
			}
		}
	}

	private traceEdge(graphics: Graphics): void {
		const { points, offset, pointCount, reversed } = this.edgePath;
		const stride = reversed ? -2 : 2;
		let cursor = reversed ? offset + (pointCount - 1) * 2 : offset;
		graphics.moveTo(points[cursor], points[cursor + 1]);
		for (let i = 1; i < pointCount; i++) {
			cursor += stride;
			graphics.lineTo(points[cursor], points[cursor + 1]);
		}
	}

	setSearchLabels(ids: readonly number[]): void {
		this.searchLabelIds = ids.length <= 8 ? ids.slice() : [];
		this.cullDirty = true;
		this.invalidate();
	}

	setLabelImportance(importance: Float32Array | null): void {
		if (this.labelImportance === importance) return;
		this.labelImportance = importance;
		this.rebuildModernLabelOrder();
		this.cullDirty = true;
		this.invalidate();
	}

	setLabelPresentation(hoverOnly: boolean, hubs: number, fadeMs: number): void {
		if (this.hoverOnlyLabels === hoverOnly && this.labelHubCount === hubs && this.labelFadeMs === fadeMs) return;
		this.hoverOnlyLabels = hoverOnly;
		this.labelHubCount = hubs;
		this.labelFadeMs = fadeMs;
		this.cullDirty = true;
		this.invalidate();
	}

	setFolderPresentation(enabled: boolean, level: "top" | "parent", colors: Readonly<Record<string, string>>): void {
		if (this.folderMode !== level && this.model) this.folders = groupGraphFolders(this.model.nodes, level);
		this.folderMode = level;
		this.folderLabelsEnabled = enabled;
		this.folderColors = colors;
		this.cullDirty = true;
		this.invalidate();
	}

	setGlowIntensity(intensity: number): void {
		if (this.glowIntensity === intensity) return;
		this.glowIntensity = intensity;
		this.nodeTextureCache?.invalidate("glow");
		this.refreshNodeTextures();
		if (this.nodeStyle === "glow" && this.starTexture) {
			for (const sprite of this.sprites) sprite.texture = this.starTexture;
		}
		this.invalidate();
	}

	private rebuildModernLabelOrder(): void {
		const nodes = this.model?.nodes;
		if (!nodes || !this.modernAppearance) {
			this.modernLabelOrder = [];
			return;
		}
		this.modernLabelOrder = Array.from(nodes.keys()).sort((a, b) =>
			this.importanceOf(b) - this.importanceOf(a) ||
			(nodes[a].path < nodes[b].path ? -1 : nodes[a].path > nodes[b].path ? 1 : 0));
	}

	private importanceOf(id: number): number {
		const node = this.model!.nodes[id];
		return this.labelImportance?.[id] ?? node.inCount + node.outCount;
	}

	private clearModernLabels(): void {
		for (const { label } of this.labelFades.values()) label.visible = false;
		for (const label of this.folderLabels.values()) label.destroy();
		this.folderLabels.clear();
		this.labelFades.clear();
		this.folderGraphics.clear();
		this.labelClock = 0;
	}

	private layoutFolderLabels(
		opacity: number, candidates: LabelLayoutCandidate[], valid: (id: number) => boolean, scale: number
	): Map<string, { x: number; y: number; name: string }> {
		const centers = new Map<string, { x: number; y: number; name: string }>();
		this.folderGraphics.clear();
		if (opacity <= 0 || !this.positions || !this.colors) return centers;
		const light = this.host ? isLightTheme(this.host.ownerDocument) : false;
		for (const folder of this.folders) {
			let sumX = 0, sumY = 0, sumSquares = 0, visible = 0;
			for (const id of folder.ids) {
				if (!valid(id)) continue;
				const x = this.positions[id * 2];
				const y = this.positions[id * 2 + 1];
				sumX += x;
				sumY += y;
				sumSquares += x * x + y * y;
				visible++;
			}
			if (visible < 3) continue;
			const x = sumX / visible;
			const y = sumY / visible;
			const spread = Math.sqrt(Math.max(0, sumSquares / visible - x * x - y * y));
			const radius = Math.max(18 / scale, Math.min(150 / scale, spread));
			const custom = Object.hasOwn(this.folderColors, folder.path) ? this.folderColors[folder.path] : undefined;
			const color = custom && this.host
				? cssColorToNumber(custom, this.host, this.ownerWindow)
				: adaptColorToTheme(categoryColor(folder.path, FOLDER_COLORS), light);
			for (const fraction of [1, 0.8, 0.6, 0.4]) {
				this.folderGraphics.circle(x, y, radius * fraction);
				this.folderGraphics.fill({ color, alpha: opacity * 0.025 });
			}
			centers.set(folder.path, { x, y, name: folder.name });
			candidates.push({
				id: folder.path, stableKey: folder.path, role: "group", importance: visible,
				minZoom: 0, zoom: 1, wasVisible: this.labelFades.has(folder.path), placements: [],
			});
			if (centers.size >= 12) break;
		}
		return centers;
	}

	private advanceLabelFades(force: boolean): void {
		if (!this.modernAppearance || this.labelFades.size === 0) return;
		const now = this.frameNow();
		const owner = this._ownerWindow;
		const duration = owner?.matchMedia ? motionMs(this.labelFadeMs, owner) : this.labelFadeMs;
		const step = force || duration <= 0 ? 1 : Math.max(1, Math.min(50, now - this.labelClock)) / duration;
		this.labelClock = now;
		for (const [id, fade] of this.labelFades) {
			const difference = fade.target - fade.label.alpha;
			if (difference !== 0) {
				fade.label.alpha += Math.sign(difference) * Math.min(step, Math.abs(difference));
				this.invalidate();
			}
			if (fade.target !== 0 || fade.label.alpha >= 0.001) continue;
			fade.label.visible = false;
			this.labelFades.delete(id);
			this.cullDirty = true;
		}
	}

	private createTextLabel(text: string): Text {
		const label = new Text({
			text,
			style: {
				fontFamily: this.labelFontFamily(), fontSize: this.labelFontSize, fill: this.colors!.label,
				fontWeight: "500",
				stroke: { color: this.labelHalo, width: Math.max(1.75, this.labelFontSize / 5) },
			},
			resolution: 2,
		});
		label.anchor.set(0.5, 0);
		this.labelLayer.addChild(label);
		return label;
	}

	private cullModernLabels(isOnScreen: (id: number) => boolean, complete: boolean): void {
		if (!this.model || !this.positions || !this.viewport || !this.colors) return;
		const scale = this.viewport.scale;
		const distance = Math.hypot(this.camera.px - this.camera.tx, this.camera.py - this.camera.ty,
			this.camera.pz - this.camera.tz);
		const sceneZoom = this.camera.enabled
			? this.fittedCameraDistance / Math.max(1, distance) || 1
			: scale / Math.max(0.00001, this.viewport.referenceScale);
		const valid = (id: number) => id >= 0 && id < this.model!.nodes.length && isOnScreen(id) &&
			!this.hiddenMask?.[id] && this.depthScales?.[id] !== 0;
		const candidates: LabelLayoutCandidate[] = [];
		const seen = new Set<number>();
		const add = (id: number | null, role: LabelRole, minZoom = 0) => {
			if (id === null || seen.has(id) || !valid(id)) return;
			seen.add(id);
			const depth = this.camera.enabled ? this.depthScales?.[id] ?? 1 : 1;
			candidates.push({
				id, role, minZoom, zoom: this.camera.enabled ? depth : sceneZoom,
				stableKey: this.model!.nodes[id].path, importance: this.importanceOf(id),
				wasVisible: (this.labelFades.get(id)?.target ?? 0) > 0, placements: [],
			});
		};
		const show = this.labelsVisible;
		const budget = show ? this.labelMaxCount : 0;
		if (show) {
			add(this.hoveredId, "pointer");
			if (!this.hoverOnlyLabels) add(this.selectedId, "selected");
			if (this.explore) {
				add(this.explore.centerId, "action");
				add(this.explore.candidateId, "action");
				for (const id of this.explore.neighbors) add(id, "neighbor");
			}
			for (const id of this.pathNodeIds) add(id, "action");
			if (!this.hoverOnlyLabels) for (const id of this.searchLabelIds) add(id, "search");
			if (this.hoveredId !== null) for (const id of this.hoverNeighbors) add(id, "neighbor");
			if (!this.explore && !this.hoverOnlyLabels) {
				const threshold = Math.max(0, this.labelZoomThreshold);
				const detail = this.camera.enabled ? 1 :
					Math.max(0, Math.min(1, (sceneZoom - threshold + 0.1) / Math.max(0.1, threshold)));
				const normalLimit = this.labelHubCount + Math.round(detail * Math.max(0, budget * 2 - this.labelHubCount));
				let count = 0;
				for (const id of this.modernLabelOrder) {
					if (!valid(id) || seen.has(id)) continue;
					if (count >= normalLimit) break;
					if (count < this.labelHubCount) {
						add(id, "hub");
						count++;
						continue;
					}
					const wasVisible = (this.labelFades.get(id)?.target ?? 0) > 0;
					if (this.camera.enabled && (this.depthScales?.[id] ?? 1) < threshold - (wasVisible ? 0.1 : 0)) continue;
					add(id, "normal", threshold);
					count++;
				}
			}
		}
		const groupOpacity = show && this.folderLabelsEnabled && !this.explore && !this.hoverOnlyLabels
			? Math.max(0, Math.min(1, (1.9 - sceneZoom) / 0.65)) : 0;
		const centers = this.layoutFolderLabels(groupOpacity, candidates, valid, scale);
		const ranked = selectLabelCandidates(candidates, { hysteresis: 0.1 });
		const active = new Set(ranked.map((candidate) => candidate.id));
		const reserved: LabelBox[] = [];
		const originX = this.world.position.x;
		const originY = this.world.position.y;
		for (const [id, fade] of this.labelFades) {
			if (typeof id === "number" && !valid(id)) {
				fade.label.visible = false;
				this.labelFades.delete(id);
				continue;
			}
			fade.target = 0;
			if (!active.has(id) && fade.label.alpha > 0.18) {
				reserved.push({
					x: (fade.label.x - fade.label.width / 2) * scale + originX - 3,
					y: fade.label.y * scale + originY - 2,
					width: fade.label.width * scale + 6, height: fade.label.height * scale + 4,
				});
			}
		}

		let createBudget = complete ? Infinity : NEW_LABELS_PER_FRAME;
		const measured: LabelLayoutCandidate[] = [];
		const labels = new Map<LabelId, Text>();
		for (const candidate of ranked.slice(0, Math.max(8, budget * 2))) {
			const id = candidate.id;
			const oldFade = this.labelFades.get(id);
			const existing = typeof id === "number" ? this.labels.get(id) : this.folderLabels.get(id);
			if (!existing && createBudget <= 0) {
				this.cullDirty = true;
				continue;
			}
			const previousAlpha = oldFade?.label.alpha ?? 0;
			let label: Text;
			let anchorX: number;
			let anchorY: number;
			let gap: number;
			if (typeof id === "number") {
				anchorX = this.positions[id * 2];
				anchorY = this.positions[id * 2 + 1];
				gap = this.projectedCoreRadii[id] + 4 / scale;
				const lastX = existing?.x ?? 0;
				const lastY = existing?.y ?? 0;
				this.ensureLabel(id, anchorX, anchorY);
				label = this.labels.get(id)!;
				if (oldFade) label.position.set(lastX, lastY);
			} else {
				const center = centers.get(id);
				if (!center) continue;
				anchorX = center.x;
				anchorY = center.y;
				gap = 2 / scale;
				label = existing ?? this.createTextLabel(center.name);
				if (!existing) this.folderLabels.set(id, label);
			}
			if (!existing) createBudget--;
			labels.set(id, label);
			label.alpha = previousAlpha;
			const baseSize = this.labelScaleWithZoom ? Math.max(0.8, Math.min(1.2, candidate.zoom)) : 1;
			const emphasis = candidate.role === "pointer" || candidate.role === "selected" || candidate.role === "action"
				? 1.08
				: candidate.role === "neighbor" || candidate.role === "group" ? 1.04 : 1;
			const labelSize = Math.min(1.25, baseSize * emphasis);
			label.scale.set(labelSize / scale);
			const w = label.width * scale + 6;
			const h = label.height * scale + 4;
			const x = anchorX * scale + originX;
			const y = anchorY * scale + originY;
			const pad = gap * scale;
			measured.push({
				...candidate,
				placements: [
					{ x: x - w / 2, y: y + pad, width: w, height: h },
					{ x: x - w / 2, y: y - pad - h, width: w, height: h },
					{ x: x + pad, y: y - h / 2, width: w, height: h },
					{ x: x - pad - w, y: y - h / 2, width: w, height: h },
				],
				preferredPlacement: oldFade?.placement,
			});
		}
		for (const placement of placeLabelCandidates(measured, this.labelGrid, { budget, reservations: reserved })) {
			const label = labels.get(placement.id)!;
			const { box } = placement;
			label.position.set((box.x + box.width / 2 - originX) / scale, (box.y + 2 - originY) / scale);
			label.visible = true;
			this.labelFades.set(placement.id, {
				label, target: placement.role === "group" ? groupOpacity : 1, placement: placement.placementIndex,
			});
			labels.delete(placement.id);
		}
		for (const [id, label] of labels) {
			if (!this.labelFades.has(id)) label.visible = false;
		}
	}

	private drawCurveArrow(graphics: Graphics, color: number, alpha: number): void {
		const { points, offset, pointCount, reversed } = this.edgePath;
		const progress = (pointCount - 1) * (reversed ? 0.35 : 0.65);
		const segment = Math.floor(progress);
		const index = offset + segment * 2;
		const dx = points[index + 2] - points[index];
		const dy = points[index + 3] - points[index + 1];
		const fraction = progress - segment;
		const direction = reversed ? -1 : 1;
		drawArrowTip(graphics, points[index] + dx * fraction, points[index + 1] + dy * fraction,
			dx * direction, dy * direction, color, alpha);
	}

	/** Current viewport rendered at 2x into a PNG blob. */
	async exportPng(): Promise<Blob | null> {
		if (!this.app || this.contextLost || this.destroyed) return null;
		try {
			this.renderFrame(true);
			const usesDomLabels = this.labelOverlay !== null;
			if (usesDomLabels) this.labelLayer.renderable = true;
			let canvas: HTMLCanvasElement;
			try {
				canvas = this.app.renderer.extract.canvas({
					target: this.app.stage,
					frame: this.app.screen,
					resolution: 2,
				}) as HTMLCanvasElement;
			} finally {
				if (usesDomLabels) this.labelLayer.renderable = false;
			}
			return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
		} catch (error) {
			console.error("Advanced Graph View: PNG export failed", error);
			return null;
		}
	}

	/** Center the viewport on a set of nodes and zoom to fit them. */
	zoomToNodes(nodeIds: readonly number[]): void {
		if (!this.app || !this.positions || !this.viewport || nodeIds.length === 0) return;
		this.invalidate();
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

	private invalidate(): void {
		this.needsRender = true;
	}

	private renderFrame(force = false): void {
		if (!this.app || this.contextLost || this.destroyed || (this.paused && !force)) return;
		// Capture work before scene updates clear flags, including the final
		// smoothing snap and the last deferred-label pass.
		if (this.smoothing || this.positionsDirty || this.edgesDirty || this.cullDirty) this.invalidate();
		this.updateScene(force);
		const now = this.frameNow();
		if (force || !RENDER_ON_DEMAND || this.needsRender || now - this.lastRenderAt >= MAX_IDLE_RENDER_MS) {
			this.syncLabelOverlay();
			this.app.render();
			this.needsRender = false;
			this.lastRenderAt = now;
		}
	}

	private updateScene(force: boolean): void {
		if (!this.model || !this.positions || !this.radii) {
			this.positionsDirty = false;
			this.edgesDirty = false;
			this.cullDirty = false;
			return;
		}

		// Close part of the gap to the worker's latest frame. Once the graph is
		// settled `smoothing` goes false and the projection stops re-running,
		// so an idle canvas costs nothing.
		if (this.smoothing && this.positions3 && this.targetPositions3) {
			this.smoothing = easePositions(
				this.positions3,
				this.targetPositions3,
				SMOOTH_FACTOR
			);
			this.reproject();
		}

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
					this.setNodeDiameter(i, depth, boost);
					sprite.zIndex = i === this.hoveredId ? Number.MAX_SAFE_INTEGER : depth;
				}
			}
			this.positionsDirty = false;
		}

		const zoom = this.camera.enabled ? 1 : (this.viewport?.scale ?? 1);
		if (zoom !== this.edgeZoom) {
			this.edgeZoom = zoom;
			this.edgesDirty = true;
		}
		if (this.edgesDirty) {
			this.edgesDirty = false;
			this.updateEdgeGeometry();
			this.redrawHoverEdges();
			this.redrawHoverNodes();
			this.redrawTrail();
			this.redrawExplore();
			this.redrawPath();
			this.redrawPins();
		}
		this.advanceHoverFocus();
		this.advanceHoverEdges();
		this.advanceEdgePulses();
		if (this.cullDirty || force) {
			const now = this.frameNow();
			// Culling correctness can lag a frame or two; don't let it eat
			// the budget on every single frame of a running simulation.
			if (force || now - this.lastCullAt >= CULL_MIN_INTERVAL_MS) {
				this.lastCullAt = now;
				this.cullDirty = false;
				// A hidden tab has a zero-sized DOM canvas even though Pixi retains the
				// last logical screen used by PNG extraction. Forced export must cull
				// against that retained viewport or every node and label disappears.
				this.cullAndLabel(force);
			}
		}
		this.advanceLabelFades(force);
	}

	private lastCullAt = 0;

	/** Zoom the 2D size floor was last applied at; a change re-derives sizes. */
	private lastSizedScale = 0;

	private cullAndLabel(complete = false): void {
		if (!this.app || !this.model || !this.positions || !this.radii || !this.viewport) return;
		const scale = this.viewport.scale;
		// Sub-percent zoom changes shift the floor by less than a pixel; skip
		// the O(n) resize until the zoom moved enough to matter.
		if (!this.camera.enabled && Math.abs(scale - this.lastSizedScale) > this.lastSizedScale * 0.01) {
			this.lastSizedScale = scale;
			this.applyHoverSize();
		}
		const view = this.app.canvas;
		const topLeft = this.viewport.toWorld(0, 0);
		const bottomRight = this.viewport.toWorld(
			complete ? this.app.screen.width : view.clientWidth,
			complete ? this.app.screen.height : view.clientHeight
		);
		const margin = Math.max(MAX_NODE_RADIUS, this.maxEncodedRadius) * this.spriteScale;

		const isOnScreen = (i: number) => {
			const x = this.positions![i * 2];
			const y = this.positions![i * 2 + 1];
			return (
				x >= topLeft.x - margin && x <= bottomRight.x + margin &&
				y >= topLeft.y - margin && y <= bottomRight.y + margin
			);
		};

		for (let i = 0; i < this.sprites.length; i++) {
			// Compensated size: in 2D the zoom floor keeps nodes above the cull
			// threshold on purpose — dots stay visible however far out you zoom.
			const bigEnough = (this.spriteDiameter(i, 1, 1) / 2) * scale >= TINY_NODE_CULL_PX;
			const hidden = this.hiddenMask !== null && this.hiddenMask[i] === 1;
			this.sprites[i].visible = isOnScreen(i) && bigEnough && !hidden;
		}
		if (this.modernAppearance) {
			this.cullModernLabels(isOnScreen, complete);
			return;
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
		let creationBudget = complete ? Infinity : NEW_LABELS_PER_FRAME;
		let creationSkipped = false;
		const labeled = new Set<number>();
		const occupiedLabelBounds: LabelBox[] = [];

		/** Show node `i`'s label, respecting the per-frame creation budget.
		 *  Returns false when it had to be deferred to a later frame. */
		const takeLabel = (i: number, avoidOverlap = false): boolean => {
			if (!this.labels.has(i) && creationBudget <= 0) {
				creationSkipped = true;
				return false;
			}
			if (!this.labels.has(i)) creationBudget--;
			this.ensureLabel(i, this.positions![i * 2], this.positions![i * 2 + 1]);
			const label = this.labels.get(i)!;
			const bounds = label.getBounds();
			const padded = { x: bounds.x - 3, y: bounds.y - 2, width: bounds.width + 6, height: bounds.height + 4 };
			if (avoidOverlap && overlapsAny(padded, occupiedLabelBounds)) {
				label.visible = false;
				return false;
			}
			occupiedLabelBounds.push(padded);
			labeled.add(i);
			return true;
		};

		// The node the user is acting on always keeps its name. These boxes are
		// reserved before decorative labels so nearby text yields to them.
		for (const i of [this.selectedId, this.hoveredId]) {
			if (i === null || labeled.has(i) || !isOnScreen(i)) continue;
			if (this.hiddenMask !== null && this.hiddenMask[i] === 1) continue;
			takeLabel(i);
		}

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

		// Same for the path tool: the route is only useful if you can read
		// which notes it runs through, whatever the zoom threshold says.
		for (const i of this.pathNodeIds) {
			if (labeled.has(i)) continue;
			if (this.hiddenMask !== null && this.hiddenMask[i] === 1) continue;
			if (this.depthScales !== null && this.depthScales[i] === 0) continue;
			if (!isOnScreen(i)) continue;
			takeLabel(i);
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
				if (takeLabel(i, true)) labelBudget--;
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
		this.invalidate();
		const changed = fontSize !== this.labelFontSize;
		this.labelsVisible = show;
		this.labelFontSize = fontSize;
		this.labelZoomThreshold = zoomThreshold;
		this.labelMaxCount = maxCount;
		this.labelScaleWithZoom = scaleWithZoom;
		if (changed) {
			this.clearModernLabels();
			for (const label of this.labels.values()) label.destroy();
			this.labels.clear();
		}
		this.cullDirty = true;
	}

	setModernAppearance(enabled: boolean, curvature = 0.13, preferCoreHitRadius = enabled): void {
		// Overview can borrow modern visuals while a legacy view keeps its hit area.
		this.preferCoreHitRadius = preferCoreHitRadius;
		const nextCurvature = Number.isFinite(curvature) ? Math.max(0, Math.min(1, curvature)) : 0.13;
		if (this.modernAppearance === enabled && this.edgeCurvature === nextCurvature) return;
		this.modernAppearance = enabled;
		if (enabled && this.fittedCameraDistance === 0 && this.positions3?.length) {
			this.fittedCameraDistance = this.cloudBounds().distance;
		}
		this.clearModernLabels();
		for (const label of this.labels.values()) label.visible = false;
		this.folders = enabled && this.model ? groupGraphFolders(this.model.nodes, this.folderMode) : [];
		this.rebuildModernLabelOrder();
		this.edgeCurvature = nextCurvature;
		this.highlightedEdgeNode = null;
		this.hoverEdgeOpacity = 0;
		this.hoverEdgeGraphics.clear();
		this.rebuildEdgeMesh();
		this.edgesDirty = true;
		this.cullDirty = true;
		this.invalidate();
	}

	setOverviewStyle(enabled: boolean): void {
		if (this.overviewStyle === enabled) return;
		this.overviewStyle = enabled;
		this.syncOverviewStyle();
		this.edgeMesh?.setAlpha(this.effectiveEdgeAlpha());
		this.invalidate();
	}

	private syncOverviewStyle(): void {
		if (!this.host) return;
		this.host.classList.toggle("graph-insight-overview", this.overviewStyle);
		this.syncBackdrop();
	}


	private effectiveEdgeAlpha(): number {
		const base = this.edgeOpacity * (this.overviewStyle ? OVERVIEW_EDGE_ALPHA_FACTOR : 1);
		if (this.presentationLinks !== null) {
			return base * (0.42 + (EXPLORE_BACKGROUND_EDGE_DIM - 0.42) * this.presentationLinks);
		}
		if (this.explore) return base * EXPLORE_BACKGROUND_EDGE_DIM;
		return base * (1 - (1 - HOVER_BACKGROUND_EDGE_ALPHA) * this.hoverFocus);
	}

	private effectiveEdgeWidth(): number {
		return edgeWorldWidth(this.edgeWidth, this.camera.enabled ? 1 : (this.viewport?.scale ?? 1));
	}

	private syncEdgePalette(): void {
		if (this.colors) this.edgeMesh?.setPalette(this.encodedTints, this.colors.nodeSelected, this.colors.label);
	}

	setEdgeStyle(show: boolean, width: number, opacity: number): void {
		this.invalidate();
		this.edgesVisible = show;
		if (this.edgeWidth !== width) this.edgesDirty = true;
		this.edgeWidth = width;
		this.edgeOpacity = opacity;
		this.edgeMesh?.setVisible(show);
		this.edgeMesh?.setAlpha(this.effectiveEdgeAlpha());
		if (!show) this.clearEdgePulses(false);
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
		if (!this.host) return;
		this.invalidate();
		this.cullDirty = true;
		this.colors = readThemeColors(this.host, this.ownerWindow);
		if (this.overviewStyle) this.syncOverviewStyle();
		this.labelHalo = cssColorToNumber(
			this.ownerWindow.getComputedStyle(this.host).getPropertyValue("--background-primary").trim() || "#1e1e1e",
			this.host,
			this.ownerWindow
		);
		this.clearModernLabels();
		for (const label of this.labels.values()) label.destroy();
		this.labels.clear();
		this.syncEdgePalette();
		this.positionsDirty = true;
		this.edgesDirty = true;
	}

	setVisualStyle(style: NodeStyle, backdrop: number | null, schemeId = this.colorScheme): void {
		this.invalidate();
		this.backdrop = backdrop;
		this.syncBackdrop();
		const schemeChanged = schemeId !== this.colorScheme;
		if (schemeChanged) {
			this.colorScheme = schemeId;
			this.refreshNodeTextures();
		}
		if (style === this.nodeStyle && !schemeChanged) return;
		this.nodeStyle = style;
		this.spriteScale = style === "glow" ? STAR_SIZE_FACTOR : 1;

		const texture = this.textureForStyle(style);
		if (!texture) return;
		for (const sprite of this.sprites) {
			sprite.texture = texture;
			sprite.blendMode = style === "glow" ? "add" : "normal";
		}
		this.applyHoverSize(); // re-applies every sprite size with the new scale
		this.cullDirty = true;
	}

	private syncBackdrop(): void {
		if (!this.app) return;
		this.app.renderer.background.alpha = this.backdrop === null || this.overviewStyle ? 0 : 1;
		if (this.backdrop !== null) this.app.renderer.background.color = this.backdrop;
	}

	private textureForStyle(style: NodeStyle): Texture {
		if (style === "glow") return this.starTexture ?? this.nodeTexture!;
		if (style === "ring") return this.ringTexture ?? this.nodeTexture!;
		return this.nodeTexture!;
	}

	private refreshNodeTextures(): void {
		if (!this.nodeTextureCache) return;
		this.nodeTexture = this.nodeTextureCache.get(this.colorScheme, "flat", this.glowIntensity);
		this.starTexture = this.nodeTextureCache.get(this.colorScheme, "glow", this.glowIntensity);
		this.ringTexture = this.nodeTextureCache.get(this.colorScheme, "ring", this.glowIntensity);
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
					fontFamily: this.labelFontFamily(),
					fontWeight: "500",
					// Halo in the theme background color keeps text readable
					// on top of edges and glowing nodes.
					stroke: { color: this.labelHalo, width: Math.max(1.75, this.labelFontSize / 5) },
				},
				resolution: 2,
			});
			label.anchor.set(0.5, 0);
			this.labels.set(nodeId, label);
			this.labelLayer.addChild(label);
		}
		label.position.set(x, y + this.radii[nodeId] + 2);
		// Depth-matched label brightness: near names crisp, far ones fading
		// almost out — legibility itself reads as distance.
		if (this.camera.enabled && this.depthScales) {
			label.alpha = labelDepthAlpha(this.depthScales[nodeId]);
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

	private labelFontFamily(): string {
		return this.ownerWindow.getComputedStyle(this.ownerWindow.document.body)
			.getPropertyValue("--font-interface").trim() || "sans-serif";
	}

	private syncLabelOverlay(): void {
		if (!this.host || !this.viewport || !this.colors) return;
		if (!this.labelOverlay) {
			this.labelOverlay = new LabelOverlay(this.host);
			// The DOM mirror is the sharp on-screen layer. Pixi text stays alive
			// for measurements, collision layout and explicit PNG extraction.
			this.labelLayer.renderable = false;
		}
		const scale = this.viewport.scale;
		const originX = this.world.position.x;
		const originY = this.world.position.y;
		const emphasized = new Set(this.pathNodeIds);
		if (this.hoveredId !== null) emphasized.add(this.hoveredId);
		if (this.selectedId !== null) emphasized.add(this.selectedId);
		for (const id of this.hoverNeighbors) emphasized.add(id);
		if (this.explore) {
			emphasized.add(this.explore.centerId);
			if (this.explore.candidateId !== null) emphasized.add(this.explore.candidateId);
			for (const id of this.explore.neighbors) emphasized.add(id);
		}
		const visible: OverlayLabel[] = [];
		const append = (id: LabelId, label: Text) => {
			if (!label.visible || label.alpha <= 0.001) return;
			visible.push({
				id,
				text: String(label.text),
				x: label.x * scale + originX,
				y: label.y * scale + originY,
				scale: label.scale.x * scale,
				alpha: label.alpha,
				weight: typeof id === "string" || emphasized.has(id) ? 600 : 500,
			});
		};
		if (this.modernAppearance) {
			for (const [id, fade] of this.labelFades) append(id, fade.label);
		} else {
			for (const [id, label] of this.labels) append(id, label);
		}
		this.labelOverlay.sync(visible, {
			fontFamily: this.labelFontFamily(),
			fontSize: this.labelFontSize,
			fill: this.cssHex(this.colors.label),
			halo: this.cssHex(this.labelHalo),
		});
	}

	private cssHex(color: number): string {
		return `#${color.toString(16).padStart(6, "0")}`;
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
			projectedCoreRadii: this.preferCoreHitRadius ? this.projectedCoreRadii : null,
		});
	}

	/** Node pressed but not yet moved past the drag threshold. */
	private pressedId: number | null = null;
	private pressedEvent: PointerEvent | null = null;
	/** Node under a pressed middle mouse button, resolved on release. */
	private middlePressedId: number | null = null;
	private draggingId: number | null = null;
	/** Holds a single click back for one double-click window (F-02). */
	private clickDispatcher = new ClickDispatcher({
		onClick: (nodeId, event) => this.callbacks.onNodeClick(nodeId, event),
		onDoubleClick: (nodeId) => this.callbacks.onNodeDoubleClick(nodeId),
	}, undefined, () => this.ownerWindow);
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
		for (const index of this.incidentEdges[this.hoveredId] ?? []) {
			const { source, target } = this.model.edges[index];
			this.hoverNeighbors.add(source === this.hoveredId ? target : source);
		}
	}

	private resetHoverFocus(): void {
		this.hoverFocus = 0;
		this.highlightedEdgeNode = null;
		this.hoverEdgeOpacity = 0;
		this.hoverEdgeGraphics.clear();
		this.hoverNodeGraphics.clear();
	}

	private advanceHoverFocus(): void {
		const target = this.hoveredId === null || this.explore !== null || this.presentationLinks !== null ? 0 : 1;
		if (this.hoverFocus === target) return;
		const now = this.frameNow();
		const owner = this._ownerWindow;
		const duration = owner?.matchMedia ? motionMs(HOVER_FOCUS_FADE_MS, owner) : HOVER_FOCUS_FADE_MS;
		const step = Math.max(1, now - this.hoverFocusFrameAt) / duration;
		this.hoverFocusFrameAt = now;
		this.hoverFocus = target === 1 ? Math.min(1, this.hoverFocus + step) : Math.max(0, this.hoverFocus - step);
		this.applyNodeAlpha();
		this.edgeMesh?.setAlpha(this.effectiveEdgeAlpha());
		this.invalidate();
	}

	private startEdgePulses(origin: number | null, neighbors?: readonly number[]): void {
		if (origin === null || !this.edgesVisible ||
			this.hiddenMask?.[origin] === 1 || !this._ownerWindow ||
			(typeof this._ownerWindow.matchMedia === "function" && prefersReducedMotion(this._ownerWindow))) {
			this.clearEdgePulses();
			return;
		}
		const visibleIncident = (this.incidentEdges[origin] ?? []).filter((edgeIndex) => {
			if (neighbors) {
				const edge = this.model?.edges[edgeIndex];
				if (!edge || !neighbors.includes(edge.source === origin ? edge.target : edge.source)) return false;
			}
			return this.edgeMesh?.getEdgePath(edgeIndex, this.edgePath) === true;
		});
		const edgeIndices = selectPulseEdges(visibleIncident);
		if (edgeIndices.length === 0) {
			this.clearEdgePulses();
			return;
		}
		this.edgePulseBatch = { origin, startedAt: this.frameNow(), edgeIndices };
		this.advanceEdgePulses();
	}

	private clearEdgePulses(invalidate = true): void {
		if (this.edgePulseBatch === null) return;
		this.edgePulseBatch = null;
		this.edgePulseGraphics.clear();
		if (invalidate) this.invalidate();
	}

	private tracePulse(points: readonly number[]): void {
		if (points.length < 4) return;
		this.edgePulseGraphics.moveTo(points[0], points[1]);
		for (let i = 2; i < points.length; i += 2) {
			this.edgePulseGraphics.lineTo(points[i], points[i + 1]);
		}
	}

	private advanceEdgePulses(): void {
		const batch = this.edgePulseBatch;
		if (!batch) return;
		if (!this.edgesVisible || this.paused ||
			this.hiddenMask?.[batch.origin] === 1 || !this.model || !this.colors) {
			this.clearEdgePulses();
			return;
		}

		const graphics = this.edgePulseGraphics;
		graphics.clear();
		const elapsed = this.frameNow() - batch.startedAt;
		const scale = Math.max(0.001, this.viewport?.scale ?? 1);
		const frontColor = this.host && isLightTheme(this.host.ownerDocument) ? 0xdcecff : 0xffffff;
		let running = false;
		let pathAvailable = false;
		for (let order = 0; order < batch.edgeIndices.length; order++) {
			const edgeIndex = batch.edgeIndices[order];
			const phase = edgePulsePhase(elapsed, pulseDelay(order, batch.edgeIndices.length));
			if (!phase.done) running = true;
			if (!this.edgeMesh?.getEdgePath(edgeIndex, this.edgePath)) continue;
			pathAvailable = true;
			if (!phase.visible) continue;
			const edge = this.model.edges[edgeIndex];
			if (!edge || (edge.source !== batch.origin && edge.target !== batch.origin)) continue;
			const path = {
				points: this.edgePath.points,
				offset: this.edgePath.offset,
				pointCount: this.edgePath.pointCount,
				reversed: edge.target === batch.origin && edge.source !== batch.origin,
			};

			if (phase.head < 1) {
				const tail = slicePackedPath(path, phase.tail, phase.head, this.edgePulseScratch);
				if (tail.length >= 4) {
					this.tracePulse(tail);
					graphics.stroke({ color: this.colors.nodeSelected, alpha: 0.28, width: 3.2 / scale });
					this.tracePulse(tail);
					graphics.stroke({ color: frontColor, alpha: 0.92, width: 1.15 / scale });
					const x = tail[tail.length - 2];
					const y = tail[tail.length - 1];
					graphics.circle(x, y, 3.6 / scale).fill({ color: this.colors.nodeSelected, alpha: 0.2 });
					graphics.circle(x, y, 1.65 / scale).fill({ color: frontColor, alpha: 0.98 });
				}
			} else if (phase.arrival > 0) {
				const endpoint = slicePackedPath(path, 1, 1, this.edgePulseScratch);
				if (endpoint.length >= 2) {
					const x = endpoint[endpoint.length - 2];
					const y = endpoint[endpoint.length - 1];
					graphics.circle(x, y, (4 + phase.arrival * 5) / scale)
						.fill({ color: this.colors.nodeSelected, alpha: phase.arrival * 0.14 });
					graphics.circle(x, y, (1.5 + phase.arrival * 2.5) / scale)
						.fill({ color: frontColor, alpha: phase.arrival * 0.72 });
				}
			}
		}

		if (!running || !pathAvailable) {
			this.edgePulseBatch = null;
			graphics.clear();
		}
		this.invalidate();
	}

	private advanceHoverEdges(): void {
		if (this.explore !== null || this.presentationLinks !== null) return;
		const target = this.edgesVisible ? this.hoveredId : null;
		if (target === this.highlightedEdgeNode &&
			this.hoverEdgeOpacity === (target === null ? 0 : 1)) return;

		const now = this.frameNow();
		const owner = this._ownerWindow;
		const duration = owner?.matchMedia ? motionMs(HOVER_EDGE_FADE_MS, owner) : HOVER_EDGE_FADE_MS;
		const step = Math.min(1, Math.max(1, now - this.hoverEdgeFrameAt) / duration);
		this.hoverEdgeFrameAt = now;
		if (this.hoverEdgeOpacity === 0 && target !== this.highlightedEdgeNode) {
			this.highlightedEdgeNode = target;
			this.redrawHoverEdges();
		}
		this.hoverEdgeOpacity = target === this.highlightedEdgeNode && target !== null
			? Math.min(1, this.hoverEdgeOpacity + step)
			: Math.max(0, this.hoverEdgeOpacity - step);
		this.hoverEdgeGraphics.alpha = this.hoverEdgeOpacity;
		this.invalidate();
	}

	private redrawHoverEdges(): void {
		const graphics = this.hoverEdgeGraphics;
		graphics.clear();
		const id = this.highlightedEdgeNode;
		if (this.explore !== null || this.presentationLinks !== null || !this.edgesVisible || id === null ||
			!this.positions || !this.model || !this.colors) return;
		const incident = this.incidentEdges[id];
		if (!incident) return;
		let count = 0;
		for (const index of incident) {
			if (!this.edgeMesh?.getEdgePath(index, this.edgePath)) continue;
			this.traceEdge(graphics);
			if (++count >= HOVER_EDGE_LIMIT) break;
		}
		if (count > 0) graphics.stroke({
			color: edgeColor(-1, -1, this.colors.nodeSelected, this.colors.label),
			alpha: 0.93,
			width: HOVER_EDGE_WIDTH_PX / Math.max(0.001, this.viewport?.scale ?? 1),
		});
	}

	/** Keep the local neighborhood legible even when node textures are tiny. */
	private redrawHoverNodes(): void {
		const g = this.hoverNodeGraphics;
		g.clear();
		const center = this.hoveredId;
		if (center === null || this.explore || this.presentationLinks !== null || !this.positions || !this.colors) return;
		const scale = Math.max(0.001, this.viewport?.scale ?? 1);
		const halo = this.labelHalo;
		const accent = edgeColor(-1, -1, this.colors.nodeSelected, this.colors.label);
		const visible = (id: number) => this.sprites[id]?.visible && this.hiddenMask?.[id] !== 1
			&& (!this.camera.enabled || this.depthScales?.[id] !== 0);

		let count = 0;
		for (const id of this.hoverNeighbors) {
			if (id === center || !visible(id)) continue;
			const x = this.positions[id * 2], y = this.positions[id * 2 + 1];
			const radius = Math.max(3.2 / scale, Math.min(7.5 / scale, this.projectedCoreRadii[id] || 0));
			g.circle(x, y, radius).fill({ color: halo, alpha: 0.92 });
			g.circle(x, y, radius).stroke({ color: accent, width: 1.45 / scale });
			g.circle(x, y, 1.65 / scale).fill({ color: this.colors.label });
			if (++count >= HOVER_EDGE_LIMIT) break;
		}
		if (!visible(center)) return;
		const x = this.positions[center * 2], y = this.positions[center * 2 + 1];
		const radius = Math.max(8 / scale, (this.projectedCoreRadii[center] || 0) + 3 / scale);
		g.circle(x, y, radius + 3 / scale).fill({ color: accent, alpha: 0.23 });
		g.circle(x, y, radius).fill({ color: halo, alpha: 0.90 });
		g.circle(x, y, radius).stroke({ color: this.colors.label, width: 2 / scale });
		g.circle(x, y, radius * 0.42).fill({ color: accent });
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
				this.invalidate();
			}
			this.callbacks.onCameraChanged?.();
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
			this.callbacks.onCameraChanged?.();
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
				this.startEdgePulses(this.draggingId);
				this.moveDraggedNode(event);
				return;
			}
		}
		if (this.explore) {
			const nodeId = this.findNodeAt(event.clientX, event.clientY);
			const directNeighbor =
				nodeId !== null &&
				nodeId !== this.explore.centerId &&
				this.explore.neighbors.includes(nodeId);
			this.callbacks.onExploreAim(
				nodeId === null
					? this.aimFromPointer(event.clientX, event.clientY)
					: directNeighbor ? nodeId : null,
				event.clientX,
				event.clientY
			);
			if (nodeId !== null) {
				this.callbacks.onNodeHover(nodeId, event.clientX, event.clientY);
			}
			this.callbacks.onNodePreview?.(nodeId, event);
			return;
		}
		if (this.presentationLinks !== null) return;
		const nodeId = this.findNodeAt(event.clientX, event.clientY);
		if (nodeId !== this.hoveredId) {
			this.invalidate();
			this.cullDirty = true;
			this.hoveredId = nodeId;
			this.hoverEdgeFrameAt = this.hoverFocusFrameAt = this.frameNow();
			this.updateHoverNeighbors();
			this.startEdgePulses(nodeId);
			this.applyNodeTints();
			this.applyNodeAlpha();
			this.applyHoverSize();
			this.redrawHoverNodes();
		}
		this.callbacks.onNodeHover(nodeId, event.clientX, event.clientY);
		this.callbacks.onNodePreview?.(nodeId, event);
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
			const nodeId = this.findNodeAt(event.clientX, event.clientY);
			if (nodeId !== null) {
				if (this.viewport) this.viewport.suppressPan = true;
				if (nodeId !== this.explore.centerId) {
					this.callbacks.onNodeClick(nodeId, event);
				}
				return;
			}
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
			this.clickDispatcher.press(this.pressedId, this.pressedEvent);
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
		this.invalidate();
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
		this.invalidate();
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
		if (this.destroyed) return;
		this.destroyed = true;
		this.stopFrames();
		this.clearEdgePulses(false);
		this.clickDispatcher.cancel();
		this.viewport?.destroy();
		this.viewport = null;
		this.edgeMesh?.destroy();
		this.edgeMesh = null;
		this.labelOverlay?.destroy();
		this.labelOverlay = null;
		const app = this.app;
		this.app = null;
		this.host?.classList.remove("graph-insight-overview");
		this.host = null;
		if (app) {
			app.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
			app.canvas.removeEventListener("pointerdown", this.handlePointerDown);
			app.canvas.removeEventListener("contextmenu", this.handleContextMenu);
			app.canvas.removeEventListener("wheel", this.handleWheel, { capture: true });
			this._ownerWindow?.removeEventListener("pointermove", this.handlePointerMove);
			this._ownerWindow?.removeEventListener("pointerup", this.handlePointerUp);
			this._ownerWindow?.removeEventListener("resize", this.handleWindowResize);
			app.destroy({ removeView: true }, { children: true, texture: true });
		}
		this.nodeTextureCache?.destroy();
		this.nodeTextureCache = null;
		this._ownerWindow = null;
	}
}
