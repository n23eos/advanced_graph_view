import { describe, expect, it } from "vitest";
import { createTowForce, type TowNode } from "./towForce";

const FRAME = 1 / 60;

/** A chain 0 - 1 - 2 - 3 - 4 laid out along x, 50 apart. */
function chain(): { nodes: TowNode[]; edges: Uint32Array } {
	const nodes: TowNode[] = [];
	for (let i = 0; i < 5; i++) nodes.push({ id: i, x: 0 - i * 50, y: 0 });
	return { nodes, edges: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 4]) };
}

function setup(graph = chain()) {
	let now = 0;
	const force = createTowForce(() => now);
	force.initialize(graph.nodes);
	force.setEdges(graph.nodes.length, graph.edges);
	/** Run the tow for `seconds` at display rate, sampling after every frame. */
	const run = (seconds: number, each?: () => void) => {
		const frames = Math.round(seconds / FRAME);
		for (let f = 0; f < frames; f++) {
			now += FRAME * 1000;
			force();
			each?.();
		}
	};
	/** Put the grabbed node where the pointer is, the way the engine pins it. */
	const hold = (id: number, x: number, y = 0) => {
		graph.nodes[id].x = graph.nodes[id].fx = x;
		graph.nodes[id].y = graph.nodes[id].fy = y;
	};
	return { force, nodes: graph.nodes, run, hold };
}

/** How far node i has moved along x from where the chain put it. */
const moved = (nodes: TowNode[], i: number) => (nodes[i].x ?? 0) + i * 50;

describe("createTowForce", () => {
	it("does nothing until a node is grabbed", () => {
		const { force, nodes, run, hold } = setup();
		hold(0, 300);
		run(1);
		expect(nodes[1].x).toBe(-50);
		expect(force.active()).toBe(false);
	});

	it("grabbing alone moves nothing — no jerk on mouse down", () => {
		const { force, nodes, run } = setup();
		force.grab(0);
		run(1);
		expect(nodes.map((n) => n.x)).toEqual([0, -50, -100, -150, -200]);
	});

	it("claims three rings and no further", () => {
		const { force, nodes, run, hold } = setup();
		force.grab(0);
		expect(force.towed()).toEqual([1, 2, 3]);
		hold(0, 300);
		run(6);
		expect(nodes[4].x).toBe(-200);
		expect(nodes[4].fx ?? null).toBeNull();
	});

	it("carries the neighbourhood along, less with every ring", () => {
		const { nodes, run, hold, force } = setup();
		force.grab(0);
		hold(0, 300);
		run(8);
		expect(moved(nodes, 1)).toBeGreaterThan(300 * 0.85);
		expect(moved(nodes, 1)).toBeLessThan(300);
		expect(moved(nodes, 2)).toBeGreaterThan(300 * 0.5);
		expect(moved(nodes, 2)).toBeLessThan(moved(nodes, 1));
		expect(moved(nodes, 3)).toBeGreaterThan(300 * 0.25);
		expect(moved(nodes, 3)).toBeLessThan(moved(nodes, 2));
	});

	it("keeps the neighbourhood's shape: a node ahead of the drag moves ahead too", () => {
		const nodes: TowNode[] = [
			{ id: 0, x: 0, y: 0 },
			{ id: 1, x: 60, y: 0 }, // in the direction of travel
			{ id: 2, x: 0, y: 60 }, // off to the side
		];
		const { force, run, hold } = setup({ nodes, edges: new Uint32Array([0, 1, 0, 2]) });
		force.grab(0);
		hold(0, 300);
		run(8);
		expect(nodes[1].x ?? 0).toBeGreaterThan(300);
		expect(nodes[2].y).toBeCloseTo(60, 6);
	});

	describe("the motion itself", () => {
		it("starts from rest: the first frame barely moves", () => {
			const { nodes, run, hold, force } = setup();
			force.grab(0);
			hold(0, 300);
			run(FRAME);
			expect(moved(nodes, 1)).toBeLessThan(300 * 0.005);
		});

		it("gathers speed, then sheds it — no frame is abruptly faster than the last", () => {
			const { nodes, run, hold, force } = setup();
			force.grab(0);
			hold(0, 300);
			let previous = moved(nodes, 1);
			let previousStep = 0;
			let peak = 0;
			run(4, () => {
				const step = moved(nodes, 1) - previous;
				previous = moved(nodes, 1);
				// Acceleration is bounded: speed changes by a sliver per frame.
				expect(Math.abs(step - previousStep)).toBeLessThan(0.75);
				previousStep = step;
				peak = Math.max(peak, step);
			});
			expect(peak).toBeGreaterThan(1);
			expect(previousStep).toBeLessThan(peak / 10);
		});

		it("never overshoots or turns back", () => {
			const { nodes, run, hold, force } = setup();
			force.grab(0);
			hold(0, 300);
			let previous = [0, 0, 0, 0];
			run(10, () => {
				for (let i = 1; i <= 3; i++) {
					expect(moved(nodes, i)).toBeGreaterThanOrEqual(previous[i] - 1e-9);
					expect(moved(nodes, i)).toBeLessThan(300);
					previous[i] = moved(nodes, i);
				}
			});
			previous = [];
		});

		it("travels as a chain: each ring is behind the one before it", () => {
			const { nodes, run, hold, force } = setup();
			force.grab(0);
			hold(0, 300);
			run(0.5);
			// Share of its own final travel each ring has covered so far.
			const done = [1, 2, 3].map((i) => moved(nodes, i));
			run(12);
			const share = [1, 2, 3].map((i, n) => done[n] / moved(nodes, i));
			expect(share[0]).toBeGreaterThan(share[1]);
			expect(share[1]).toBeGreaterThan(share[2]);
		});

		it("does not depend on the tick rate", () => {
			const fast = setup();
			fast.force.grab(0);
			fast.hold(0, 300);
			fast.run(1);

			let now = 0;
			const graph = chain();
			const slow = createTowForce(() => now);
			slow.initialize(graph.nodes);
			slow.setEdges(graph.nodes.length, graph.edges);
			slow.grab(0);
			graph.nodes[0].x = graph.nodes[0].fx = 300;
			for (let step = 0; step < 25; step++) { // 25 Hz for the same second
				now += 40;
				slow();
			}
			expect(moved(graph.nodes, 1)).toBeCloseTo(moved(fast.nodes, 1), 0);
		});

		it("resumes after a stall instead of jumping", () => {
			let now = 0;
			const graph = chain();
			const force = createTowForce(() => now);
			force.initialize(graph.nodes);
			force.setEdges(graph.nodes.length, graph.edges);
			force.grab(0);
			graph.nodes[0].x = graph.nodes[0].fx = 300;
			now += 16;
			force();
			now += 5000; // the worker was blocked for five seconds
			force();
			expect(moved(graph.nodes, 1)).toBeLessThan(300 * 0.05);
		});
	});

	describe("release", () => {
		/** A quick flick: the pointer lands 300 away and lets go at once. */
		function flicked() {
			const ctx = setup();
			ctx.force.grab(0);
			ctx.hold(0, 300);
			ctx.run(0.1);
			ctx.force.release();
			return ctx;
		}

		it("keeps the neighbourhood drifting until it has gathered around the drop", () => {
			const { force, nodes, run } = flicked();
			expect(force.active()).toBe(true);
			expect(moved(nodes, 1)).toBeLessThan(300 * 0.1);
			run(9);
			expect(force.active()).toBe(false);
			expect(moved(nodes, 1)).toBeGreaterThan(300 * 0.9);
			expect(moved(nodes, 2)).toBeGreaterThan(300 * 0.55);
		});

		it("takes its time: half way after a second, nearly there after three and a half", () => {
			const { nodes, run } = flicked();
			const final = 300 * 0.92;
			run(1);
			expect(moved(nodes, 1) / final).toBeGreaterThan(0.3);
			expect(moved(nodes, 1) / final).toBeLessThan(0.7);
			run(2.5);
			expect(moved(nodes, 1) / final).toBeGreaterThan(0.93);
			expect(moved(nodes, 1) / final).toBeLessThan(1);
		});

		it("letting go is not felt: speed carries straight through the release", () => {
			const ctx = setup();
			ctx.force.grab(0);
			ctx.hold(0, 300);
			let previous = moved(ctx.nodes, 1);
			let before = 0;
			ctx.run(0.4, () => {
				before = moved(ctx.nodes, 1) - previous;
				previous = moved(ctx.nodes, 1);
			});
			ctx.force.release();
			ctx.run(FRAME);
			const after = moved(ctx.nodes, 1) - previous;
			expect(Math.abs(after - before)).toBeLessThan(before * 0.05);
		});

		it("hands every node back to the layout, at rest, once gathered", () => {
			const { force, nodes, run } = flicked();
			run(9);
			expect(force.towed()).toEqual([]);
			for (const node of nodes.slice(1)) {
				expect(node.fx ?? null).toBeNull();
				expect(node.vx ?? 0).toBe(0);
			}
		});

		it("holds its nodes against the simulation while they drift", () => {
			const { nodes, run } = flicked();
			run(0.5);
			expect(nodes[1].fx).toBe(nodes[1].x);
		});
	});

	it("releasing a tow that never moved hands its nodes straight back", () => {
		const { force, nodes, run } = setup();
		force.grab(0);
		run(0.2);
		force.release();
		run(0.1);
		expect(nodes.map((n) => n.x)).toEqual([0, -50, -100, -150, -200]);
		expect(force.active()).toBe(false);
	});

	it("follows a hub less than a leaf", () => {
		// 0 is grabbed; 1 is a leaf, 2 is a hub carrying twenty more links.
		const nodes: TowNode[] = [
			{ id: 0, x: 0, y: 0 },
			{ id: 1, x: -50, y: 10 },
			{ id: 2, x: -50, y: -10 },
		];
		const edges = [0, 1, 0, 2];
		for (let i = 3; i < 23; i++) {
			nodes.push({ id: i, x: -100, y: -10 - i });
			edges.push(2, i);
		}
		const { force, run, hold } = setup({ nodes, edges: new Uint32Array(edges) });
		force.grab(0);
		hold(0, 300);
		run(8);
		expect((nodes[2].x ?? 0) + 50).toBeLessThan(((nodes[1].x ?? 0) + 50) * 0.7);
		expect((nodes[2].x ?? 0) + 50).toBeGreaterThan(60);
	});

	it("does not reach through a node the user pinned", () => {
		const graph = chain();
		graph.nodes[1].fx = -50;
		graph.nodes[1].fy = 0;
		const { force, nodes, run, hold } = setup(graph);
		force.grab(0);
		expect(force.towed()).toEqual([]);
		hold(0, 300);
		run(3);
		expect(nodes[1].fx).toBe(-50);
		expect(nodes[2].x).toBe(-100);
	});

	it("tows along z in a 3D layout", () => {
		const nodes: TowNode[] = [
			{ id: 0, x: 0, y: 0, z: 0 },
			{ id: 1, x: 0, y: 0, z: -50 },
		];
		const { force, run } = setup({ nodes, edges: new Uint32Array([0, 1]) });
		force.grab(0);
		nodes[0].z = nodes[0].fz = 300;
		run(8);
		expect(nodes[1].z ?? 0).toBeGreaterThan(200);
		expect(nodes[1].x).toBeCloseTo(0, 6);
	});

	it("a new grab ends a tow still drifting and frees its nodes", () => {
		const { force, nodes, run, hold } = setup();
		force.grab(0);
		hold(0, 300);
		run(0.1);
		force.release();
		run(0.2);
		force.grab(4);
		expect(nodes[1].fx ?? null).toBeNull();
		expect(force.towed()).toEqual([3, 2, 1]);
	});

	it("ignores an unknown id and drops the tow when the graph is replaced", () => {
		const { force, nodes } = setup();
		force.grab(99);
		expect(force.active()).toBe(false);
		force.grab(0);
		force.setEdges(nodes.length, new Uint32Array([0, 1]));
		expect(force.towed()).toEqual([]);
		expect(force.active()).toBe(false);
	});
});
