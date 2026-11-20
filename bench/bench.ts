/**
 * Standalone performance harness for the real GraphRenderer + LayoutClient.
 *
 * Query parameters:
 *   nodes=5000|10000
 *   camera=2d|3d
 *   worker=2d|3d
 *   seed=<uint32>
 *   scale=standard|high
 *   version=<label included in the result>
 *
 * Camera and worker dimensions must match. The same source is intended to be
 * built on both 0.12.0-beta.1 and 0.12.0-beta.2.
 */
import { buildGraphModel, type GraphModel, type LinkMap } from "../src/data/GraphStore";
import { GraphRenderer } from "../src/render/GraphRenderer";
import { LayoutClient } from "../src/workers/LayoutClient";
import type { Application, Container, Sprite } from "pixi.js";
import { installObsidianDom } from "../src/test/obsidianDom";

const LAYOUT_TIMEOUT_MS = 30_000;
const SAMPLE_MS = 4_000;
const IDLE_SAMPLE_MS = 30_000;
const HOVER_EFFECT_MS = 300;
const DEFAULT_SEED = 42;
const FOLDER_COUNT = 48;
const BENCHMARK_SCHEMA = "graph-visuals-t003-v1";

type DimensionMode = "2d" | "3d";

interface BenchmarkConfig {
	nodeCount: 5_000 | 10_000;
	seed: number;
	cameraMode: DimensionMode;
	workerMode: DimensionMode;
	renderScale: "standard" | "high";
	version: string;
}

interface FrameStats {
	frames: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
	stalledFrames: number;
	longFrames: number;
	fps: number;
}

interface GestureCheck {
	passed: boolean;
	detail: string;
}

interface BenchmarkChecks {
	hover: GestureCheck;
	drag: GestureCheck;
	pan: GestureCheck;
	orbit: GestureCheck;
	zoom: GestureCheck;
}

interface BenchmarkResult {
	schema: typeof BENCHMARK_SCHEMA;
	version: string;
	renderScale: "standard" | "high";
	cameraMode: DimensionMode;
	workerMode: DimensionMode;
	seed: number;
	seedChecksum: string;
	devicePixelRatio: number;
	canvasWidth: number;
	canvasHeight: number;
	nodes: number;
	edges: number;
	folders: number;
	modelMs: number;
	rendererInitMs: number;
	setModelMs: number;
	firstWorkerFrameMs: number;
	layoutSettled: boolean;
	layoutMs: number;
	layoutTicks: number;
	layoutTickMedianMs: number | null;
	layoutTickP95Ms: number | null;
	layoutLastAlpha: number | null;
	layoutFrames: FrameStats;
	dragFrames: FrameStats;
	panFrames: FrameStats;
	orbitFrames: FrameStats | null;
	zoomFrames: FrameStats;
	checks: BenchmarkChecks;
	idleWarmupSettled: boolean;
	idle: { durationMs: number; frames: FrameStats; renders: number; renderCpuMs: number; tickCpuMs: number };
	errors: string[];
	verdict: "PASS" | "FAIL";
}

interface RendererRuntime {
	app: Application;
	renderFrame(): void;
	world: Container;
	sprites: Sprite[];
	positions3: Float32Array | null;
	hoveredId: number | null;
	smoothing: boolean;
}

interface PointerTarget {
	nodeId: number;
	clientX: number;
	clientY: number;
}

const observedErrors: string[] = [];
window.addEventListener("error", (event) => {
	observedErrors.push(event.message || "window error");
});
window.addEventListener("unhandledrejection", (event) => {
	observedErrors.push(String(event.reason));
});

function parseConfig(): BenchmarkConfig {
	const params = new URLSearchParams(window.location.search);
	const mode = parseMode(params.get("mode"), "3d", "mode");
	const cameraMode = parseMode(params.get("camera"), mode, "camera");
	const workerMode = parseMode(params.get("worker"), mode, "worker");
	if (cameraMode !== workerMode) {
		throw new Error(`camera=${cameraMode} and worker=${workerMode} must match`);
	}
	const rawNodes = params.get("nodes") ?? "10000";
	if (rawNodes !== "5000" && rawNodes !== "10000") {
		throw new Error(`nodes must be 5000 or 10000, received ${rawNodes}`);
	}
	const rawSeed = params.get("seed") ?? String(DEFAULT_SEED);
	const parsedSeed = Number(rawSeed);
	if (!Number.isInteger(parsedSeed) || parsedSeed < 0 || parsedSeed > 0xffff_ffff) {
		throw new Error(`seed must be an unsigned 32-bit integer, received ${rawSeed}`);
	}
	return {
		nodeCount: Number(rawNodes) as BenchmarkConfig["nodeCount"],
		seed: parsedSeed >>> 0,
		cameraMode,
		workerMode,
		renderScale: params.get("scale") === "high" ? "high" : "standard",
		version: params.get("version") ?? "local",
	};
}

function parseMode(value: string | null, fallback: DimensionMode, name: string): DimensionMode {
	if (value === null) return fallback;
	if (value !== "2d" && value !== "3d") throw new Error(`${name} must be 2d or 3d, received ${value}`);
	return value;
}

function mulberry32(seed: number): () => number {
	let state = seed | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function folderPath(index: number): string {
	const roots = ["Projects", "Areas", "Archive", "Исследования", "Материалы", "Daily"];
	const root = roots[index % roots.length];
	const branch = `cluster-${String(index).padStart(2, "0")}`;
	return `${root}/${branch}/topic-${index % 8}`;
}

function makeSyntheticVault(nodeCount: number, seed: number): {
	files: string[];
	resolved: LinkMap;
	folderCount: number;
} {
	const files: string[] = [];
	for (let i = 0; i < nodeCount; i++) {
		const folder = folderPath(i % FOLDER_COUNT);
		const name = i === nodeCount - 1
			? `последняя-заметка-с-длинным-уникальным-именем-${i}`
			: `note-${String(i).padStart(5, "0")}`;
		files.push(`${folder}/${name}.md`);
	}

	const random = mulberry32(seed);
	const resolved: LinkMap = {};
	for (let source = 0; source < nodeCount; source++) {
		const targets: Record<string, number> = {};
		for (let slot = 0; slot < 3; slot++) {
			let target: number;
			if (slot === 0 && source > 0 && source <= 640) target = 0;
			else if (source === 0 && slot === 0) target = 1;
			else target = Math.floor(Math.pow(random(), 2.5) * nodeCount);
			if (target === source) target = (target + 1) % nodeCount;
			targets[files[target]] = 1;
		}
		resolved[files[source]] = targets;
	}
	return { files, resolved, folderCount: FOLDER_COUNT };
}

function makeSeedPositions(nodeCount: number, seed: number, dimensions: 2 | 3): Float32Array {
	const random = mulberry32(seed ^ 0x9e37_79b9);
	const positions = new Float32Array(nodeCount * 3);
	for (let i = 0; i < nodeCount; i++) {
		const cluster = i % FOLDER_COUNT;
		const angle = (cluster / FOLDER_COUNT) * Math.PI * 2;
		const ring = 850 + (cluster % 4) * 110;
		const jitterRadius = Math.sqrt(random()) * 180;
		const jitterAngle = random() * Math.PI * 2;
		positions[i * 3] = Math.cos(angle) * ring + Math.cos(jitterAngle) * jitterRadius;
		positions[i * 3 + 1] = Math.sin(angle) * ring + Math.sin(jitterAngle) * jitterRadius;
		positions[i * 3 + 2] = dimensions === 3 ? (cluster % 8 - 3.5) * 90 + (random() - 0.5) * 180 : 0;
	}
	return positions;
}

function positionChecksum(positions: Float32Array): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < positions.length; i++) {
		const value = Math.round(positions[i] * 1000) | 0;
		hash ^= value;
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function log(line: string): void {
	console.log(`[bench] ${line}`);
	const element = document.getElementById("results");
	if (element) element.textContent += line + "\n";
}

function percentile(sorted: readonly number[], fraction: number): number {
	if (sorted.length === 0) return Infinity;
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function formatNullable(value: number | null, digits: number): string {
	return value === null ? "n/a" : value.toFixed(digits);
}

async function nextFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function delay(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
	const startedAt = performance.now();
	while (performance.now() - startedAt < timeoutMs) {
		if (predicate()) return true;
		await nextFrame();
	}
	return predicate();
}

async function measureFrames(label: string, driveFrame: (t: number) => void, ms: number): Promise<FrameStats> {
	return new Promise((resolve) => {
		const frames: number[] = [];
		let stalledFrames = 0;
		let last = 0;
		let start = 0;
		const step = () => {
			const now = performance.now();
			if (start === 0) {
				start = now;
				last = now;
				requestAnimationFrame(step);
				return;
			}
			const delta = now - last;
			last = now;
			if (delta > 500) stalledFrames++;
			else frames.push(delta);
			driveFrame(Math.min(1, (now - start) / ms));
			if (now - start < ms) {
				requestAnimationFrame(step);
			} else {
				frames.sort((a, b) => a - b);
				const medianMs = percentile(frames, 0.5);
				const p95Ms = percentile(frames, 0.95);
				const maxMs = frames.at(-1) ?? Infinity;
				const fps = 1000 / medianMs;
				const longFrames = frames.filter((frame) => frame > 33.34).length;
				const stalledNote = stalledFrames > 0 ? `, stalled=${stalledFrames}` : "";
				log(
					`${label}: ${fps.toFixed(1)} fps, median=${medianMs.toFixed(2)}ms, ` +
					`p95=${p95Ms.toFixed(2)}ms, max=${maxMs.toFixed(2)}ms, ` +
					`long>33ms=${longFrames}/${frames.length}${stalledNote}`
				);
				resolve({ frames: frames.length, medianMs, p95Ms, maxMs, stalledFrames, longFrames, fps });
			}
		};
		requestAnimationFrame(step);
	});
}

async function waitUntilSettled(settled: Promise<void>, startedAt: number): Promise<boolean> {
	const remaining = Math.max(0, LAYOUT_TIMEOUT_MS - (performance.now() - startedAt));
	return Promise.race([
		settled.then(() => true),
		new Promise<false>((resolve) => setTimeout(() => resolve(false), remaining)),
	]);
}

function cameraDistance(
	left: ReturnType<GraphRenderer["getCameraState"]>,
	right: ReturnType<GraphRenderer["getCameraState"]>,
	mode: DimensionMode,
	kind: "pan" | "orbit" | "zoom"
): number {
	if (!left || !right) return 0;
	if (mode === "2d") {
		if (kind === "zoom") return Math.abs(right.viewport.scale - left.viewport.scale);
		return Math.hypot(
			right.viewport.centerX - left.viewport.centerX,
			right.viewport.centerY - left.viewport.centerY
		);
	}
	if (kind === "orbit") {
		return Math.hypot(
			right.camera3d.yaw - left.camera3d.yaw,
			right.camera3d.pitch - left.camera3d.pitch
		);
	}
	return Math.hypot(
		right.camera3d.position.x - left.camera3d.position.x,
		right.camera3d.position.y - left.camera3d.position.y,
		right.camera3d.position.z - left.camera3d.position.z
	);
}

function nodeClientPosition(renderer: GraphRenderer, runtime: RendererRuntime, nodeId: number): PointerTarget | null {
	const positions = renderer.projectedPositions;
	const canvas = renderer.canvasElement;
	if (!positions || !canvas) return null;
	const rect = canvas.getBoundingClientRect();
	const clientX = rect.left + runtime.world.position.x + positions[nodeId * 2] * runtime.world.scale.x;
	const clientY = rect.top + runtime.world.position.y + positions[nodeId * 2 + 1] * runtime.world.scale.y;
	if (
		clientX < rect.left + 12 || clientX > rect.right - 12 ||
		clientY < rect.top + 12 || clientY > rect.bottom - 12
	) return null;
	return { nodeId, clientX, clientY };
}

function findNodePointer(renderer: GraphRenderer, runtime: RendererRuntime, model: GraphModel): PointerTarget | null {
	for (const node of model.nodes) {
		if (node.inCount + node.outCount === 0) continue;
		const point = nodeClientPosition(renderer, runtime, node.id);
		if (!point) continue;
		const hit = renderer.previewNodeAt(point.clientX, point.clientY);
		if (hit === null || model.nodes[hit].inCount + model.nodes[hit].outCount === 0) continue;
		const hitPoint = nodeClientPosition(renderer, runtime, hit);
		if (hitPoint && renderer.previewNodeAt(hitPoint.clientX, hitPoint.clientY) === hit) return hitPoint;
	}
	return null;
}

function findEmptyPointer(renderer: GraphRenderer): { clientX: number; clientY: number } | null {
	const canvas = renderer.canvasElement;
	if (!canvas) return null;
	const rect = canvas.getBoundingClientRect();
	for (let y = 24; y <= rect.height - 24; y += 40) {
		for (let x = 24; x <= rect.width - 24; x += 40) {
			const clientX = rect.left + x;
			const clientY = rect.top + y;
			if (renderer.previewNodeAt(clientX, clientY) === null) return { clientX, clientY };
		}
	}
	return null;
}

function pointerEvent(target: EventTarget, type: string, init: PointerEventInit): void {
	target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function movedDistance(positions: Float32Array, before: Float32Array, nodeId: number): number {
	const offset = nodeId * 3;
	return Math.hypot(
		positions[offset] - before[offset],
		positions[offset + 1] - before[offset + 1],
		positions[offset + 2] - before[offset + 2]
	);
}

function neighborsOf(model: GraphModel, nodeId: number): number[] {
	const neighbors = new Set<number>();
	for (const edge of model.edges) {
		if (edge.source === nodeId) neighbors.add(edge.target);
		else if (edge.target === nodeId) neighbors.add(edge.source);
	}
	return [...neighbors];
}

function check(name: string, passed: boolean, detail: string): GestureCheck {
	log(`${name} check: ${passed ? "PASS" : "FAIL"} - ${detail}`);
	if (!passed) observedErrors.push(`${name} check failed: ${detail}`);
	return { passed, detail };
}

async function main(): Promise<void> {
	installObsidianDom();
	const config = parseConfig();
	log(
		`scenario: version=${config.version}, nodes=${config.nodeCount}, seed=${config.seed}, ` +
		`camera=${config.cameraMode}, worker=${config.workerMode}, scale=${config.renderScale}`
	);

	const host = document.getElementById("graph");
	if (!host) throw new Error("graph host is missing");
	const buildStart = performance.now();
	const { files, resolved, folderCount } = makeSyntheticVault(config.nodeCount, config.seed);
	const model = buildGraphModel(files, resolved, {});
	const seedPositions = makeSeedPositions(
		model.nodes.length,
		config.seed,
		config.workerMode === "3d" ? 3 : 2
	);
	const seedChecksum = positionChecksum(seedPositions);
	const modelMs = performance.now() - buildStart;
	log(
		`model: ${model.nodes.length} nodes, ${model.edges.length} edges, ` +
		`${folderCount} folders, seed checksum=${seedChecksum}, ${modelMs.toFixed(0)}ms`
	);

	let hoverCallbackNode: number | null = null;
	let dragStartedId: number | null = null;
	let dragEndedId: number | null = null;
	let dragMoveCount = 0;
	let lastDragPosition: [number, number, number] | null = null;
	let workerAliveAtRelease = false;
	let layout: LayoutClient | null = null;
	const renderer = new GraphRenderer({
		onCameraChanged: () => {},
		onNodePreview: () => {},
		onNodeHover: (nodeId) => { hoverCallbackNode = nodeId; },
		onNodeClick: () => {},
		onNodeDoubleClick: () => {},
		onNodeMiddleClick: () => {},
		onNodeContextMenu: () => {},
		onNodeDragStart: (nodeId) => {
			dragStartedId = nodeId;
			layout?.dragStart(nodeId);
		},
		onNodeDrag: (nodeId, x, y, z) => {
			dragMoveCount++;
			lastDragPosition = [x, y, z];
			layout?.dragMove(nodeId, x, y, z);
		},
		onNodeDragEnd: (nodeId) => {
			dragEndedId = nodeId;
			workerAliveAtRelease = (layout as unknown as { worker: Worker | null } | null)?.worker !== null;
			layout?.dragEnd();
		},
		onLassoSelect: () => {},
		onExploreAim: () => {},
		onExploreJump: () => {},
		onContextLost: () => {},
	});
	const rendererInitStart = performance.now();
	await renderer.init(host, config.renderScale);
	const rendererInitMs = performance.now() - rendererInitStart;
	const runtime = renderer as unknown as RendererRuntime;
	const pixiRenderer = runtime.app.renderer;
	const originalRender = pixiRenderer.render;
	const originalTick = runtime.renderFrame;
	let renderCount = 0;
	let renderCpuMs = 0;
	let tickCpuMs = 0;
	pixiRenderer.render = ((...args: unknown[]) => {
		const start = performance.now();
		try { return Reflect.apply(originalRender, pixiRenderer, args); }
		finally { renderCount++; renderCpuMs += performance.now() - start; }
	}) as typeof originalRender;
	runtime.renderFrame = function () {
		const start = performance.now();
		try { return originalTick.call(this); }
		finally { tickCpuMs += performance.now() - start; }
	};

	const setModelStart = performance.now();
	const appearance = new URLSearchParams(window.location.search).get("appearance");
	if (appearance === "modern" || appearance === "overview") {
		renderer.setModernAppearance(true, appearance === "overview" ? 0.10 : 0.18);
	}
	if (appearance === "overview") {
		renderer.setOverviewStyle(true);
		renderer.setLabelPresentation(false, 4, 200);
		renderer.setGlowIntensity(0.44);
	}
	renderer.setModel(model);
	// Do not rely on GraphRenderer's 3D default or LayoutClient's 2D default.
	renderer.set3DMode(config.cameraMode === "3d");
	const setModelMs = performance.now() - setModelStart;
	log(`renderer: init=${rendererInitMs.toFixed(0)}ms, setModel=${setModelMs.toFixed(0)}ms, camera=${config.cameraMode}`);

	let firstTickAt = 0;
	let lastAlpha: number | null = null;
	let latestWorkerPositions = new Float32Array(seedPositions);
	const tickTimes: number[] = [];
	let resolveFirstTick: (() => void) | null = null;
	let resolveSettled: (() => void) | null = null;
	const firstTick = new Promise<void>((resolve) => { resolveFirstTick = resolve; });
	const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
	layout = new LayoutClient(
		(positions, alpha) => {
			const now = performance.now();
			tickTimes.push(now);
			lastAlpha = alpha;
			latestWorkerPositions = new Float32Array(positions);
			if (firstTickAt === 0) {
				firstTickAt = now;
				resolveFirstTick?.();
			}
			renderer.updatePositions(positions);
		},
		(positions) => {
			latestWorkerPositions = new Float32Array(positions);
			renderer.updatePositions(positions);
			resolveSettled?.();
		},
		(reason) => observedErrors.push(`layout worker: ${reason}`)
	);
	const layoutStart = performance.now();
	const workerDimensions = config.workerMode === "3d" ? 3 : 2;
	layout.start(model, seedPositions, workerDimensions);
	const firstTickArrived = await Promise.race([
		firstTick.then(() => true),
		new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
	]);
	if (!firstTickArrived) throw new Error("layout worker did not deliver a frame within 10s");
	await nextFrame();
	const firstWorkerFrameMs = firstTickAt - layoutStart;
	log(`layout: worker=${config.workerMode}, first frame=${firstWorkerFrameMs.toFixed(0)}ms`);

	const layoutFrames = await measureFrames("layout active", () => {}, SAMPLE_MS);
	const layoutSettled = await waitUntilSettled(settled, layoutStart);
	const layoutMs = performance.now() - layoutStart;
	log(`layout: ${layoutSettled ? "settled" : "timeout"} after ${layoutMs.toFixed(0)}ms; worker remains connected for gestures`);

	renderer.fitAll();
	await nextFrame();
	await nextFrame();

	const hoverTarget = findNodePointer(renderer, runtime, model);
	if (!hoverTarget) throw new Error("could not find a visible node for hover");
	const hoverWidthBefore = runtime.sprites[hoverTarget.nodeId]?.width ?? 0;
	const ticksBeforeHover = tickTimes.length;
	pointerEvent(window, "pointermove", {
		clientX: hoverTarget.clientX,
		clientY: hoverTarget.clientY,
		buttons: 0,
	});
	await delay(HOVER_EFFECT_MS);
	await nextFrame();
	const hoverWidthAfter = runtime.sprites[hoverTarget.nodeId]?.width ?? 0;
	const hoverWorkerConnected = (layout as unknown as { worker: Worker | null }).worker !== null;
	const hoverCheck = check(
		"hover",
		hoverCallbackNode === hoverTarget.nodeId && runtime.hoveredId === hoverTarget.nodeId &&
			hoverWidthAfter > hoverWidthBefore && hoverWorkerConnected,
		`node=${hoverTarget.nodeId}, callback=${hoverCallbackNode ?? "null"}, ` +
		`width=${hoverWidthBefore.toFixed(2)}->${hoverWidthAfter.toFixed(2)}, ` +
		`workerConnected=${hoverWorkerConnected}, workerTicks=${tickTimes.length - ticksBeforeHover}`
	);

	const dragTarget = findNodePointer(renderer, runtime, model);
	if (!dragTarget) throw new Error("could not find a visible node for drag");
	const dragBefore = new Float32Array(latestWorkerPositions);
	const ticksBeforeDrag = tickTimes.length;
	dragStartedId = null;
	dragEndedId = null;
	dragMoveCount = 0;
	lastDragPosition = null;
	workerAliveAtRelease = false;
	const canvas = renderer.canvasElement;
	if (!canvas) throw new Error("renderer canvas is missing");
	pointerEvent(canvas, "pointerdown", {
		button: 0,
		buttons: 1,
		clientX: dragTarget.clientX,
		clientY: dragTarget.clientY,
	});
	const dragFrames = await measureFrames("node drag", (t) => {
		pointerEvent(window, "pointermove", {
			button: 0,
			buttons: 1,
			clientX: dragTarget.clientX + t * 140,
			clientY: dragTarget.clientY + Math.sin(t * Math.PI) * 55,
		});
	}, SAMPLE_MS);
	pointerEvent(window, "pointerup", {
		button: 0,
		buttons: 0,
		clientX: dragTarget.clientX + 140,
		clientY: dragTarget.clientY,
	});
	const ticksAtRelease = tickTimes.length;
	await waitFor(() => tickTimes.length > ticksAtRelease, 1_000);
	await delay(250);
	const draggedId = dragStartedId ?? dragTarget.nodeId;
	const draggedDistance = movedDistance(latestWorkerPositions, dragBefore, draggedId);
	let neighborDistance = 0;
	for (const neighbor of neighborsOf(model, draggedId)) {
		neighborDistance = Math.max(neighborDistance, movedDistance(latestWorkerPositions, dragBefore, neighbor));
	}
	const dragTicks = tickTimes.length - ticksBeforeDrag;
	const dragCheck = check(
		"drag",
		dragStartedId === dragTarget.nodeId && dragEndedId === dragTarget.nodeId && dragMoveCount > 0 &&
			lastDragPosition !== null && workerAliveAtRelease && dragTicks > 0 &&
			draggedDistance > 1 && neighborDistance > 0.01,
		`node=${dragTarget.nodeId}, start=${dragStartedId ?? "null"}, end=${dragEndedId ?? "null"}, ` +
		`moves=${dragMoveCount}, workerTicks=${dragTicks}, workerAliveAtRelease=${workerAliveAtRelease}, ` +
		`nodeDelta=${draggedDistance.toFixed(2)}, neighborDelta=${neighborDistance.toFixed(2)}`
	);

	const emptyPointer = findEmptyPointer(renderer);
	if (!emptyPointer) throw new Error("could not find an empty canvas point for camera gestures");
	const panBefore = renderer.getCameraState();
	pointerEvent(canvas, "pointerdown", {
		button: 2,
		buttons: 2,
		clientX: emptyPointer.clientX,
		clientY: emptyPointer.clientY,
	});
	const panFrames = await measureFrames("camera pan", (t) => {
		pointerEvent(window, "pointermove", {
			button: 2,
			buttons: 2,
			clientX: emptyPointer.clientX + t * 120,
			clientY: emptyPointer.clientY + Math.sin(t * Math.PI) * 35,
		});
	}, SAMPLE_MS);
	pointerEvent(window, "pointerup", {
		button: 2,
		buttons: 0,
		clientX: emptyPointer.clientX + 120,
		clientY: emptyPointer.clientY,
	});
	const panDelta = cameraDistance(panBefore, renderer.getCameraState(), config.cameraMode, "pan");
	const panCheck = check("pan", panDelta > 1, `${config.cameraMode} camera delta=${panDelta.toFixed(3)}`);

	let orbitFrames: FrameStats | null = null;
	let orbitCheck: GestureCheck;
	if (config.cameraMode === "3d") {
		const orbitPointer = findEmptyPointer(renderer);
		if (!orbitPointer) throw new Error("could not find an empty canvas point for orbit");
		const orbitBefore = renderer.getCameraState();
		pointerEvent(canvas, "pointerdown", {
			button: 0,
			buttons: 1,
			clientX: orbitPointer.clientX,
			clientY: orbitPointer.clientY,
		});
		orbitFrames = await measureFrames("camera orbit", (t) => {
			pointerEvent(window, "pointermove", {
				button: 0,
				buttons: 1,
				clientX: orbitPointer.clientX + t * 150,
				clientY: orbitPointer.clientY + t * 45,
			});
		}, SAMPLE_MS);
		pointerEvent(window, "pointerup", {
			button: 0,
			buttons: 0,
			clientX: orbitPointer.clientX + 150,
			clientY: orbitPointer.clientY + 45,
		});
		const orbitDelta = cameraDistance(orbitBefore, renderer.getCameraState(), config.cameraMode, "orbit");
		orbitCheck = check("orbit", orbitDelta > 0.01, `yaw/pitch delta=${orbitDelta.toFixed(4)}`);
	} else {
		orbitCheck = check("orbit", true, "skipped in 2d mode; pan is measured separately");
	}

	const zoomBefore = renderer.getCameraState();
	const canvasRect = canvas.getBoundingClientRect();
	const zoomFrames = await measureFrames("zoom", () => {
		canvas.dispatchEvent(new WheelEvent("wheel", {
			deltaY: -2,
			clientX: canvasRect.left + canvasRect.width / 2,
			clientY: canvasRect.top + canvasRect.height / 2,
			bubbles: true,
			cancelable: true,
		}));
	}, SAMPLE_MS);
	const zoomDelta = cameraDistance(zoomBefore, renderer.getCameraState(), config.cameraMode, "zoom");
	const zoomCheck = check("zoom", zoomDelta > 0.001, `${config.cameraMode} camera delta=${zoomDelta.toFixed(3)}`);

	layout.stop();
	const idleWarmupSettled = await waitFor(() => !runtime.smoothing, 5_000);
	log(`idle warmup: renderer smoothing ${idleWarmupSettled ? "settled" : "did not settle"}`);
	if (!idleWarmupSettled) observedErrors.push("renderer smoothing did not settle before idle sample");

	const tickIntervals = tickTimes.slice(1).map((time, index) => time - tickTimes[index]);
	tickIntervals.sort((a, b) => a - b);
	const tickMedianMs = tickIntervals.length > 0 ? percentile(tickIntervals, 0.5) : null;
	const tickP95Ms = tickIntervals.length > 0 ? percentile(tickIntervals, 0.95) : null;
	log(
		`layout: ticks=${tickTimes.length}, tick interval median=${formatNullable(tickMedianMs, 2)}ms, ` +
		`p95=${formatNullable(tickP95Ms, 2)}ms, last alpha=${formatNullable(lastAlpha, 4)}`
	);

	renderCount = 0;
	renderCpuMs = 0;
	tickCpuMs = 0;
	log("idle: sampling for 30 seconds");
	const idleStart = performance.now();
	const idleFrames = await measureFrames("idle", () => {}, IDLE_SAMPLE_MS);
	const idle = {
		durationMs: performance.now() - idleStart,
		frames: idleFrames,
		renders: renderCount,
		renderCpuMs,
		tickCpuMs,
	};
	log(`idle: renders=${idle.renders}, render JS=${idle.renderCpuMs.toFixed(2)}ms, tick JS=${idle.tickCpuMs.toFixed(2)}ms`);

	const checks: BenchmarkChecks = {
		hover: hoverCheck,
		drag: dragCheck,
		pan: panCheck,
		orbit: orbitCheck,
		zoom: zoomCheck,
	};
	const activeFrames = [layoutFrames, dragFrames, panFrames, zoomFrames, ...(orbitFrames ? [orbitFrames] : [])];
	const verdict =
		activeFrames.every((frames) => frames.fps >= 50) &&
		Object.values(checks).every((gesture) => gesture.passed) &&
		observedErrors.length === 0
			? "PASS"
			: "FAIL";
	const result: BenchmarkResult = {
		schema: BENCHMARK_SCHEMA,
		version: config.version,
		renderScale: config.renderScale,
		cameraMode: config.cameraMode,
		workerMode: config.workerMode,
		seed: config.seed,
		seedChecksum,
		devicePixelRatio: window.devicePixelRatio,
		canvasWidth: canvas.width,
		canvasHeight: canvas.height,
		nodes: model.nodes.length,
		edges: model.edges.length,
		folders: folderCount,
		modelMs,
		rendererInitMs,
		setModelMs,
		firstWorkerFrameMs,
		layoutSettled,
		layoutMs,
		layoutTicks: tickTimes.length,
		layoutTickMedianMs: tickMedianMs,
		layoutTickP95Ms: tickP95Ms,
		layoutLastAlpha: lastAlpha,
		layoutFrames,
		dragFrames,
		panFrames,
		orbitFrames,
		zoomFrames,
		checks,
		idleWarmupSettled,
		idle,
		errors: [...observedErrors],
		verdict,
	};
	(window as typeof window & { __graphBenchmark?: BenchmarkResult }).__graphBenchmark = result;
	log(`errors: ${observedErrors.length}`);
	log(`RESULT_JSON ${JSON.stringify(result)}`);
	log(`verdict: ${verdict} (target 50 fps median and all gesture effects verified)`);
	document.title = `bench ${verdict}`;
}

main().catch((error) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	observedErrors.push(message);
	log(`ERROR: ${message}`);
	document.title = "bench FAIL";
});
