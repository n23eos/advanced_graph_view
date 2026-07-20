/** Diagnostic bench: settle graph, then live FPS in title; layers togglable
 *  from the console via window.diag. */
import { buildGraphModel, type LinkMap } from "../src/data/GraphStore";
import { GraphRenderer } from "../src/render/GraphRenderer";
import { LayoutClient } from "../src/workers/LayoutClient";

const N = 10000, E = 30000;

function vault(): { files: string[]; resolved: LinkMap } {
	const files: string[] = [];
	for (let i = 0; i < N; i++) files.push(`note-${i}.md`);
	const resolved: LinkMap = {};
	let seed = 42;
	const rnd = () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	for (let e = 0; e < E; e++) {
		const s = Math.floor(rnd() * N);
		const t = Math.floor(Math.pow(rnd(), 2.5) * N);
		if (s === t) continue;
		(resolved[files[s]] ??= {})[files[t]] = 1;
	}
	return { files, resolved };
}

async function main() {
	const host = document.getElementById("graph")!;
	const { files, resolved } = vault();
	const model = buildGraphModel(files, resolved, {});
	const renderer = new GraphRenderer({
		onNodeHover: () => {}, onNodeClick: () => {}, onNodeDoubleClick: () => {},
		onNodeContextMenu: () => {}, onNodeDragStart: () => {}, onNodeDrag: () => {},
		onNodeDragEnd: () => {}, onLassoSelect: () => {}, onSemanticEdgeClick: () => {},
	});
	await renderer.init(host);
	renderer.setModel(model);
	const layout = new LayoutClient(
		(p) => renderer.updatePositions(p),
		(p) => renderer.updatePositions(p)
	);
	layout.start(model);
	await new Promise((r) => setTimeout(r, 6000));
	layout.stop();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const r = renderer as any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(window as any).diag = {
		renderer, model,
		app: r.app, world: r.world, nodeLayer: r.nodeLayer,
		labelLayer: r.labelLayer, edgeMesh: r.edgeMesh,
		jiggle: false,
		positions: () => r.positions as Float32Array,
	};

	// Live FPS + optional per-frame position churn (simulates sim ticks).
	let last = performance.now();
	const samples: number[] = [];
	const loop = () => {
		const now = performance.now();
		samples.push(now - last);
		last = now;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if ((window as any).diag.jiggle) {
			const p = r.positions as Float32Array;
			p[0] += Math.sin(now / 100);
			renderer.updatePositions(p);
		}
		if (samples.length >= 60) {
			samples.sort((a, b) => a - b);
			const med = samples[30];
			document.title = `fps ${(1000 / med).toFixed(1)} (${med.toFixed(1)}ms)`;
			samples.length = 0;
		}
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
}
void main();
