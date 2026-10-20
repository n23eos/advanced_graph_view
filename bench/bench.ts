/**
 * Standalone performance harness: renders a synthetic 10k-node / 30k-edge
 * graph with the real GraphRenderer + LayoutClient (no Obsidian involved),
 * then measures FPS during scripted pan and zoom. Results go to console
 * as [bench] lines and onto the page.
 */
import { buildGraphModel, type LinkMap } from "../src/data/GraphStore";
import { GraphRenderer } from "../src/render/GraphRenderer";
import { LayoutClient } from "../src/workers/LayoutClient";
import { installObsidianDom } from "../src/test/obsidianDom";

const NODE_COUNT = 10_000;
const EDGE_COUNT = 30_000;
const LAYOUT_TIMEOUT_MS = 30_000;
const SAMPLE_MS = 4_000;

interface FrameStats {
	frames: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
	stalledFrames: number;
	longFrames: number;
	fps: number;
}

interface BenchmarkResult {
	nodes: number;
	edges: number;
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
	panFrames: FrameStats;
	zoomFrames: FrameStats;
	errors: string[];
	verdict: "PASS" | "FAIL";
}

const observedErrors: string[] = [];
window.addEventListener("error", (event) => {
	observedErrors.push(event.message || "window error");
});
window.addEventListener("unhandledrejection", (event) => {
	observedErrors.push(String(event.reason));
});

function makeSyntheticVault(): { files: string[]; resolved: LinkMap } {
	const files: string[] = [];
	for (let i = 0; i < NODE_COUNT; i++) files.push(`note-${i}.md`);

	// Preferential attachment-ish: early notes become hubs, like a real vault.
	const resolved: LinkMap = {};
	// mulberry32: stays within 32-bit ops, no float precision loss
	let seed = 42;
	const random = () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	for (let e = 0; e < EDGE_COUNT; e++) {
		const source = Math.floor(random() * NODE_COUNT);
		const target = Math.floor(Math.pow(random(), 2.5) * NODE_COUNT);
		if (source === target) continue;
		const sourcePath = files[source];
		resolved[sourcePath] ??= {};
		resolved[sourcePath][files[target]] = 1;
	}
	return { files, resolved };
}

function log(line: string): void {
	console.log(`[bench] ${line}`);
	const el = document.getElementById("results")!;
	el.textContent += line + "\n";
}

function percentile(sorted: readonly number[], fraction: number): number {
	if (sorted.length === 0) return Infinity;
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function nextFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
				// First rAF only establishes the clock; the page may have been
				// throttled in a background tab before this point.
				start = now;
				last = now;
				requestAnimationFrame(step);
				return;
			}
			const delta = now - last;
			last = now;
			// Tab occlusion stalls would poison the stats, so count them separately.
			if (delta > 500) stalledFrames++;
			else frames.push(delta);
			driveFrame((now - start) / ms);
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
				resolve({
					frames: frames.length,
					medianMs,
					p95Ms,
					maxMs,
					stalledFrames,
					longFrames,
					fps,
				});
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

async function main(): Promise<void> {
	installObsidianDom();
	const host = document.getElementById("graph")!;
	const buildStart = performance.now();
	const { files, resolved } = makeSyntheticVault();
	const model = buildGraphModel(files, resolved, {});
	const modelMs = performance.now() - buildStart;
	log(`model: ${model.nodes.length} nodes, ${model.edges.length} edges in ${modelMs.toFixed(0)}ms`);

	const renderer = new GraphRenderer({
		onNodeHover: () => {},
		onNodeClick: () => {},
		onNodeDoubleClick: () => {},
		onNodeContextMenu: () => {},
		onNodeDragStart: () => {},
		onNodeDrag: () => {},
		onNodeDragEnd: () => {},
		onLassoSelect: () => {},
		onSemanticEdgeClick: () => {},
	});
	const rendererInitStart = performance.now();
	await renderer.init(host);
	const rendererInitMs = performance.now() - rendererInitStart;
	const setModelStart = performance.now();
	renderer.setModel(model);
	const setModelMs = performance.now() - setModelStart;
	log(`renderer: init=${rendererInitMs.toFixed(0)}ms, setModel=${setModelMs.toFixed(0)}ms`);

	let firstTickAt = 0;
	let lastAlpha: number | null = null;
	const tickTimes: number[] = [];
	let resolveFirstTick: (() => void) | null = null;
	let resolveSettled: (() => void) | null = null;
	const firstTick = new Promise<void>((resolve) => { resolveFirstTick = resolve; });
	const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
	const layout = new LayoutClient(
		(positions, alpha) => {
			const now = performance.now();
			tickTimes.push(now);
			lastAlpha = alpha;
			if (firstTickAt === 0) {
				firstTickAt = now;
				resolveFirstTick?.();
			}
			renderer.updatePositions(positions);
		},
		(positions) => {
			renderer.updatePositions(positions);
			resolveSettled?.();
		}
	);
	const layoutStart = performance.now();
	layout.start(model);
	const firstTickArrived = await Promise.race([
		firstTick.then(() => true),
		new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
	]);
	if (!firstTickArrived) throw new Error("layout worker did not deliver a frame within 10s");
	await nextFrame();
	const firstWorkerFrameMs = firstTickAt - layoutStart;
	log(`layout: first worker frame=${firstWorkerFrameMs.toFixed(0)}ms`);

	const layoutFrames = await measureFrames("layout active", () => {}, SAMPLE_MS);
	const layoutSettled = await waitUntilSettled(settled, layoutStart);
	const layoutMs = performance.now() - layoutStart;
	layout.stop();

	const tickIntervals = tickTimes.slice(1).map((time, index) => time - tickTimes[index]);
	tickIntervals.sort((a, b) => a - b);
	const tickMedianMs = tickIntervals.length > 0 ? percentile(tickIntervals, 0.5) : null;
	const tickP95Ms = tickIntervals.length > 0 ? percentile(tickIntervals, 0.95) : null;
	log(
		`layout: ${layoutSettled ? "settled" : "timeout"} in ${layoutMs.toFixed(0)}ms, ` +
		`ticks=${tickTimes.length}, tick interval median=${tickMedianMs?.toFixed(2) ?? "n/a"}ms, ` +
		`p95=${tickP95Ms?.toFixed(2) ?? "n/a"}ms, last alpha=${lastAlpha?.toFixed(4) ?? "n/a"}`
	);
	renderer.fitAll();
	await nextFrame();

	const canvas = host.querySelector("canvas")!;
	const rect = canvas.getBoundingClientRect();
	const panOriginX = rect.left + 20;
	const panOriginY = rect.top + 20;
	canvas.dispatchEvent(new PointerEvent("pointerdown", {
		button: 0,
		clientX: panOriginX,
		clientY: panOriginY,
		bubbles: true,
	}));
	const panFrames = await measureFrames("pan", (t) => {
		window.dispatchEvent(new PointerEvent("pointermove", {
			clientX: panOriginX + Math.sin(t * Math.PI * 4) * 160,
			clientY: panOriginY + Math.cos(t * Math.PI * 4) * 80,
			bubbles: true,
		}));
	}, SAMPLE_MS);
	window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

	const zoomFrames = await measureFrames("zoom", (t) => {
		canvas.dispatchEvent(new WheelEvent("wheel", {
			deltaY: Math.sin(t * Math.PI * 6) * 60,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			bubbles: true,
			cancelable: true,
		}));
	}, SAMPLE_MS);

	const verdict =
		layoutFrames.fps >= 50 && panFrames.fps >= 50 && zoomFrames.fps >= 50 && observedErrors.length === 0
			? "PASS"
			: "FAIL";
	const result: BenchmarkResult = {
		nodes: model.nodes.length,
		edges: model.edges.length,
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
		panFrames,
		zoomFrames,
		errors: [...observedErrors],
		verdict,
	};
	(window as typeof window & { __graphBenchmark?: BenchmarkResult }).__graphBenchmark = result;
	log(`errors: ${observedErrors.length}`);
	log(`RESULT_JSON ${JSON.stringify(result)}`);
	log(`verdict: ${verdict} (target 50 fps median during layout, pan and zoom)`);
	document.title = `bench ${verdict}`;
}

main().catch((error) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	observedErrors.push(message);
	log(`ERROR: ${message}`);
	document.title = "bench FAIL";
});
