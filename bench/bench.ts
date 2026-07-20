/**
 * Standalone performance harness: renders a synthetic 10k-node / 30k-edge
 * graph with the real GraphRenderer + LayoutClient (no Obsidian involved),
 * then measures FPS during scripted pan and zoom. Results go to console
 * as [bench] lines and onto the page.
 */
import { buildGraphModel, type LinkMap } from "../src/data/GraphStore";
import { GraphRenderer } from "../src/render/GraphRenderer";
import { LayoutClient } from "../src/workers/LayoutClient";

const NODE_COUNT = 10_000;
const EDGE_COUNT = 30_000;

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

async function measureFps(label: string, driveFrame: (t: number) => void, ms: number): Promise<number> {
	return new Promise((resolve) => {
		const frames: number[] = [];
		let dropped = 0;
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
			// Tab-occlusion stalls would poison the stats; count them separately.
			if (delta > 500) dropped++;
			else frames.push(delta);
			driveFrame((now - start) / ms);
			if (now - start < ms) {
				requestAnimationFrame(step);
			} else {
				frames.sort((a, b) => a - b);
				const median = frames[Math.floor(frames.length / 2)] ?? Infinity;
				const p95 = frames[Math.floor(frames.length * 0.95)] ?? Infinity;
				const fps = 1000 / median;
				const droppedNote = dropped > 0 ? `, ${dropped} stalled frames dropped` : "";
				log(`${label}: median ${fps.toFixed(1)} fps (frame ${median.toFixed(2)}ms, p95 ${p95.toFixed(2)}ms${droppedNote})`);
				resolve(fps);
			}
		};
		requestAnimationFrame(step);
	});
}

async function main(): Promise<void> {
	const host = document.getElementById("graph")!;
	const buildStart = performance.now();
	const { files, resolved } = makeSyntheticVault();
	const model = buildGraphModel(files, resolved, {});
	log(`model: ${model.nodes.length} nodes, ${model.edges.length} edges in ${(performance.now() - buildStart).toFixed(0)}ms`);

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
	const initStart = performance.now();
	await renderer.init(host);
	renderer.setModel(model);

	const layout = new LayoutClient(
		(positions) => renderer.updatePositions(positions),
		(positions) => {
			renderer.updatePositions(positions);
			log("layout settled");
		}
	);
	layout.start(model);
	log(`first frame ready in ${(performance.now() - initStart).toFixed(0)}ms after init`);

	// Let the layout spread nodes out before measuring interaction FPS.
	await new Promise((r) => setTimeout(r, 6000));
	layout.stop();

	const canvas = host.querySelector("canvas")!;
	const world = { x: 0, y: 0 };

	const fpsPan = await measureFps("pan", (t) => {
		const dx = Math.sin(t * Math.PI * 4) * 14;
		const dy = Math.cos(t * Math.PI * 4) * 14;
		world.x += dx;
		world.y += dy;
		canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300, bubbles: true }));
		window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400 + dx, clientY: 300 + dy, bubbles: true }));
		window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
	}, 4000);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const prof = (window as any).__giProf;
	if (prof) log(`prof after pan: frames=${prof.frames} sprites=${prof.sprites.toFixed(0)}ms edges=${prof.edges.toFixed(0)}ms cull=${prof.cull.toFixed(0)}ms`);

	const fpsZoom = await measureFps("zoom", (t) => {
		canvas.dispatchEvent(new WheelEvent("wheel", {
			deltaY: Math.sin(t * Math.PI * 6) * 60,
			clientX: 500,
			clientY: 350,
			bubbles: true,
			cancelable: true,
		}));
	}, 4000);

	const verdict = fpsPan >= 50 && fpsZoom >= 50 ? "PASS" : "FAIL";
	log(`verdict: ${verdict} (target 50 fps)`);
	document.title = `bench ${verdict}`;
}

main().catch((error) => log(`ERROR: ${error?.stack ?? error}`));
