/**
 * Drag/tow behaviour of the layout engine.
 *
 * These are the rules that several rounds of "fix(drag): ..." commits tuned by
 * eye: the grabbed node must sit exactly under the pointer, its neighbours must
 * follow, the graph must not contract while a drag is in flight, and releasing
 * must not fling anything. Kept in their own file so the drag contract is
 * readable in one screen.
 */
import { describe, expect, test } from "vitest";
import { createLayoutEngine, type EngineOutMessage, type PhysicsParams } from "./layoutEngine";

/** The engine's clock advances one drag-cadence frame per tick, so motion
 *  that follows the wall clock (the spring-back) plays out under `step`. */
function makeEngine(lightDragAboveMs?: number) {
	const sent: EngineOutMessage[] = [];
	let now = 0;
	const engine = createLayoutEngine((message) => {
		if (message.type === "tick") now += 16;
		sent.push(message);
	}, { clock: () => now, lightDragAboveMs });
	return { engine, sent };
}

/** A hub (0) with three leaves, plus one unconnected node (4). */
const STAR_INIT = {
	type: "init" as const,
	nodeCount: 5,
	edges: new Uint32Array([0, 1, 0, 2, 0, 3]),
	weights: new Float32Array([1, 1, 1]),
	positions: new Float32Array([
		0, 0, 0, // 0 hub
		40, 0, 0, // 1
		-40, 0, 0, // 2
		0, 40, 0, // 3
		400, 400, 0, // 4 far away, unlinked
	]),
	paused: true,
};

const BASE_PARAMS: PhysicsParams = {
	repel: 50,
	linkDistance: 40,
	centering: 0.04,
	linkStrength: 0.4,
	velocityDecay: 0.4,
	elasticity: 0.4,
	freeLayout: false,
	collideRadius: 0,
};

/** Last emitted xyz for one node. `end` frames count too — a physics-disabled
 *  release posts only an `end`. */
function positionOf(sent: EngineOutMessage[], id: number): [number, number, number] {
	const last = sent[sent.length - 1];
	if (!last) throw new Error("engine has not emitted a frame yet");
	return [last.positions[id * 3], last.positions[id * 3 + 1], last.positions[id * 3 + 2]];
}

function stepTimes(engine: ReturnType<typeof makeEngine>["engine"], times: number): void {
	for (let i = 0; i < times; i++) engine.handle({ type: "step" });
}

/**
 * Run the layout to rest. Drag behaviour is only meaningful against a settled
 * graph: a still-converging one moves on its own, and that drift would be
 * misread as tow or as contraction.
 */
function settle(engine: ReturnType<typeof makeEngine>["engine"]): void {
	engine.handle({ type: "params", params: BASE_PARAMS });
	stepTimes(engine, 600);
}

/** Radius of gyration of the given nodes — one number for "how spread out". */
function spread(sent: EngineOutMessage[], ids: number[]): number {
	const points = ids.map((id) => positionOf(sent, id));
	const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
	const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
	const cz = points.reduce((s, p) => s + p[2], 0) / points.length;
	const sum = points.reduce(
		(s, p) => s + (p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2,
		0
	);
	return Math.sqrt(sum / points.length);
}

describe("dragging a node", () => {
	test("the grabbed node sits exactly where the pointer put it", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle(STAR_INIT);
		engine.handle({ type: "drag-start", id: 0 });

		// Act: drag the hub far off and keep the simulation running under it
		engine.handle({ type: "drag-move", id: 0, x: 500, y: -300, z: 0 });
		stepTimes(engine, 20);

		// Assert: physics never overrides the pointer — 1:1 tracking
		const [x, y] = positionOf(sent, 0);
		expect(x).toBeCloseTo(500, 3);
		expect(y).toBeCloseTo(-300, 3);
	});

	test("linked neighbours are towed along, unlinked nodes are not", () => {
		// Arrange: settle first, so any later movement is caused by the drag
		const { engine, sent } = makeEngine();
		engine.handle(STAR_INIT);
		settle(engine);
		const leafBefore = positionOf(sent, 1);
		const freeBefore = positionOf(sent, 4);

		// Act: yank the hub far to the right
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 600, y: 0, z: 0 });
		stepTimes(engine, 60);

		// Assert: the tow travels along links, not through empty space
		const leafMoved = Math.hypot(...positionOf(sent, 1).map((v, i) => v - leafBefore[i]));
		const freeMoved = Math.hypot(...positionOf(sent, 4).map((v, i) => v - freeBefore[i]));
		expect(leafMoved).toBeGreaterThan(50);
		expect(freeMoved).toBeLessThan(leafMoved / 3);
	});

	test("the tow propagates hop by hop, so direct links move most", () => {
		// Arrange: a chain 0 → 1 → 2 → 3
		const { engine, sent } = makeEngine();
		engine.handle({
			type: "init",
			nodeCount: 4,
			edges: new Uint32Array([0, 1, 1, 2, 2, 3]),
			weights: new Float32Array([1, 1, 1]),
			positions: new Float32Array([0, 0, 0, 40, 0, 0, 80, 0, 0, 120, 0, 0]),
			paused: true,
		});
		engine.handle({ type: "step" });
		const before = [1, 2, 3].map((id) => positionOf(sent, id));
		engine.handle({ type: "drag-start", id: 0 });

		// Act
		engine.handle({ type: "drag-move", id: 0, x: 0, y: 800, z: 0 });
		stepTimes(engine, 30);

		// Assert: displacement decays with hop distance from the grabbed node
		const moved = [1, 2, 3].map((id, i) => {
			const now = positionOf(sent, id);
			return Math.hypot(now[0] - before[i][0], now[1] - before[i][1]);
		});
		expect(moved[0]).toBeGreaterThan(moved[1]);
		expect(moved[1]).toBeGreaterThan(moved[2]);
	});

	test("the tow reaches three links out whatever the damping slider says", () => {
		// The tow is not a simulation force: neither velocityDecay nor link
		// strength shapes it, so a heavily damped preset drags like any other.
		const haul = (velocityDecay: number): number[] => {
			const { engine, sent } = makeEngine();
			engine.handle({
				type: "init",
				nodeCount: 4,
				edges: new Uint32Array([0, 1, 1, 2, 2, 3]),
				weights: new Float32Array([1, 1, 1]),
				positions: new Float32Array([0, 0, 0, 40, 0, 0, 80, 0, 0, 120, 0, 0]),
				paused: true,
			});
			engine.handle({ type: "params", params: { ...BASE_PARAMS, velocityDecay } });
			stepTimes(engine, 600);
			const before = [2, 3].map((id) => positionOf(sent, id));
			engine.handle({ type: "drag-start", id: 0 });
			engine.handle({ type: "drag-move", id: 0, x: 0, y: 900, z: 0 });
			stepTimes(engine, 400); // 6.4 s at the drag cadence
			return [2, 3].map((id, i) => positionOf(sent, id)[1] - before[i][1]);
		};

		const loose = haul(0.3);
		const stiff = haul(0.8);
		expect(loose[0]).toBeGreaterThan(450);
		expect(loose[1]).toBeGreaterThan(220);
		expect(stiff[0]).toBeCloseTo(loose[0], 3);
		expect(stiff[1]).toBeCloseTo(loose[1], 3);
	});

	test("once the tow is done, the layout runs on the user's damping again", () => {
		// drag-start drops velocityDecay for the drag. If drag-end forgot to put
		// it back, every drag would permanently leave the graph slacker than
		// the slider says.
		const drift = (velocityDecay: number): number => {
			const { engine, sent } = makeEngine();
			engine.handle(STAR_INIT);
			engine.handle({ type: "params", params: { ...BASE_PARAMS, velocityDecay } });
			stepTimes(engine, 600);

			engine.handle({ type: "drag-start", id: 0 });
			engine.handle({ type: "drag-move", id: 0, x: 400, y: 400, z: 0 });
			stepTimes(engine, 40);
			engine.handle({ type: "drag-end" });
			stepTimes(engine, 700); // tow glides out and hands its nodes back
			engine.handle({ type: "unpin", id: 0 });
			engine.handle({ type: "reheat", alpha: 0.8 });

			const before = [0, 1, 2, 3].map((id) => positionOf(sent, id));
			stepTimes(engine, 10);
			return [0, 1, 2, 3].reduce((total, id, i) => {
				const now = positionOf(sent, id);
				return total + Math.hypot(now[0] - before[i][0], now[1] - before[i][1]);
			}, 0);
		};

		// Assert: heavy damping moves less in the same ticks than light damping,
		// which can only happen if the released sim is using params again.
		expect(drift(0.8)).toBeLessThan(drift(0.3));
	});

	test("the graph does not contract while a node is dragged", () => {
		// Regression (fix(drag): stop the whole graph contracting while dragging):
		// grabbing a node used to boost centering, shrinking the entire layout.
		//
		// Both engines are run to rest first, then given an identical tick
		// budget — one under a drag, one idle. Comparing against a control
		// rather than against the starting layout separates "the drag shrank
		// the graph" from "the layout was still converging".
		const control = makeEngine();
		const dragged = makeEngine();
		for (const { engine } of [control, dragged]) {
			engine.handle(STAR_INIT);
			settle(engine);
		}

		// Act: grab the hub and hold it exactly where it already sits, so the
		// only thing under test is the warmth a drag injects.
		const [hx, hy, hz] = positionOf(dragged.sent, 0);
		dragged.engine.handle({ type: "drag-start", id: 0 });
		dragged.engine.handle({ type: "drag-move", id: 0, x: hx, y: hy, z: hz });
		stepTimes(dragged.engine, 100);
		stepTimes(control.engine, 100);

		// Assert: the rest of the graph keeps its spread
		const ids = [1, 2, 3, 4];
		expect(spread(dragged.sent, ids)).toBeGreaterThan(spread(control.sent, ids) * 0.9);
	});

	test("releasing leaves the node where it was dropped instead of flinging it", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle(STAR_INIT);
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 300, y: 300, z: 0 });
		stepTimes(engine, 10);

		// Act
		engine.handle({ type: "drag-end" });
		stepTimes(engine, 30);

		// Assert: still pinned at the drop point (unpin is a separate message)
		const [x, y] = positionOf(sent, 0);
		expect(x).toBeCloseTo(300, 3);
		expect(y).toBeCloseTo(300, 3);
	});

	test("releasing keeps the dropped node put while its neighbours gather around it", () => {
		// Arrange: a settled star, and a flick too quick for the leaves to follow
		const { engine, sent } = makeEngine();
		engine.handle(STAR_INIT);
		settle(engine);
		const leafBefore = positionOf(sent, 1);
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 400, y: 250, z: 0 });
		stepTimes(engine, 6);
		const atRelease = positionOf(sent, 1);
		expect(Math.hypot(atRelease[0] - leafBefore[0], atRelease[1] - leafBefore[1])).toBeLessThan(40);

		// Act
		engine.handle({ type: "drag-end" });
		stepTimes(engine, 700);

		// Assert: the hub is where it was dropped, the leaf has come most of the way
		const hub = positionOf(sent, 0);
		const leaf = positionOf(sent, 1);
		expect(hub[0]).toBeCloseTo(400, 3);
		expect(hub[1]).toBeCloseTo(250, 3);
		expect(Math.hypot(leaf[0] - leafBefore[0], leaf[1] - leafBefore[1])).toBeGreaterThan(350);
	});

	test("the layout keeps running until the drift is over, then settles", () => {
		// Arrange: a cold graph — nothing but the tow would keep the engine ticking
		const { engine, sent } = makeEngine();
		engine.handle(STAR_INIT);
		settle(engine);
		const leafBefore = positionOf(sent, 1);
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 300, y: 0, z: 0 });
		stepTimes(engine, 1);

		// Act
		engine.handle({ type: "drag-end" });
		stepTimes(engine, 1200);

		// Assert
		expect(positionOf(sent, 1)[0] - leafBefore[0]).toBeGreaterThan(200);
		expect(sent[sent.length - 1].type).toBe("end");
	});

	test("once the neighbours have gathered, nothing moves again", () => {
		// Regression: the layout used to keep a little heat after the tow, and
		// the links spent the next few seconds reeling some of the neighbours
		// back toward where they had started.
		const { engine, sent } = makeEngine();
		engine.handle(STAR_INIT);
		engine.handle({ type: "params", params: { ...BASE_PARAMS, linkStrength: 0.9 } });
		stepTimes(engine, 600);
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 500, y: 300, z: 0 });
		stepTimes(engine, 6);
		engine.handle({ type: "drag-end" });

		// Run until the engine reports the layout settled
		let guard = 0;
		while (sent[sent.length - 1].type !== "end" && guard++ < 2000) engine.handle({ type: "step" });
		expect(sent[sent.length - 1].type).toBe("end");
		const settled = Array.from(sent[sent.length - 1].positions);
		const arrivedAt = sent.length;

		// Everything the tow placed is exactly where the last drift frame put it
		const lastDrift = Array.from(sent[arrivedAt - 3].positions);
		for (const id of [0, 1, 2, 3]) {
			expect(settled[id * 3]).toBeCloseTo(lastDrift[id * 3], 0);
			expect(settled[id * 3 + 1]).toBeCloseTo(lastDrift[id * 3 + 1], 0);
		}
		// ...and the engine has stopped: further steps emit nothing
		stepTimes(engine, 50);
		expect(sent.length).toBe(arrivedAt);
	});

	test("unpin hands the node back to the simulation", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle(STAR_INIT);
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 900, y: 0, z: 0 });
		engine.handle({ type: "drag-end" });
		stepTimes(engine, 5);

		// Act
		engine.handle({ type: "unpin", id: 0 });
		engine.handle({ type: "reheat", alpha: 0.8 });
		stepTimes(engine, 60);

		// Assert: springs reeled the hub back toward its leaves
		const [x] = positionOf(sent, 0);
		expect(x).toBeLessThan(900);
	});

	test("every emitted coordinate stays finite through a whole drag", () => {
		// Guards the layout against a single NaN, which spreads to every linked
		// node within a few ticks and only shows up as an empty canvas.
		const { engine, sent } = makeEngine();
		engine.handle(STAR_INIT);
		engine.handle({ type: "drag-start", id: 0 });
		for (let i = 0; i < 25; i++) {
			engine.handle({ type: "drag-move", id: 0, x: i * 37, y: -i * 21, z: i * 5 });
			engine.handle({ type: "step" });
		}
		engine.handle({ type: "drag-end" });
		stepTimes(engine, 20);

		for (const message of sent) {
			expect(Array.from(message.positions).every(Number.isFinite)).toBe(true);
		}
	});
});

describe("dragging a vault too big to simulate at display rate", () => {
	/** -1: every full tick counts as too slow, so the drag runs on the tow alone. */
	const slowVault = () => makeEngine(-1);

	test("the grabbed node tracks the pointer and its neighbours are still towed", () => {
		// Arrange
		const { engine, sent } = slowVault();
		engine.handle(STAR_INIT);
		settle(engine);
		const leafBefore = positionOf(sent, 1);
		const freeBefore = positionOf(sent, 4);

		// Act
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 600, y: 0, z: 0 });
		stepTimes(engine, 60);

		// Assert
		expect(positionOf(sent, 0)[0]).toBeCloseTo(600, 3);
		expect(positionOf(sent, 1)[0] - leafBefore[0]).toBeGreaterThan(200);
		expect(positionOf(sent, 4)).toEqual(freeBefore);
	});

	test("every step still emits a frame, so the drag is drawn", () => {
		const { engine, sent } = slowVault();
		engine.handle(STAR_INIT);
		settle(engine);
		engine.handle({ type: "drag-start", id: 0 });
		const framesBefore = sent.length;
		engine.handle({ type: "drag-move", id: 0, x: 100, y: 0, z: 0 });
		stepTimes(engine, 10);
		expect(sent.length - framesBefore).toBe(10);
	});

	test("letting go hands the layout back to the full simulation, which then settles", () => {
		const { engine, sent } = slowVault();
		engine.handle(STAR_INIT);
		settle(engine);
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 300, y: 0, z: 0 });
		stepTimes(engine, 30);
		engine.handle({ type: "drag-end" });
		stepTimes(engine, 600);
		expect(sent[sent.length - 1].type).toBe("end");
		expect(positionOf(sent, 0)[0]).toBeCloseTo(300, 3);
	});

	test("releasing still gathers the neighbours around the drop", () => {
		const { engine, sent } = slowVault();
		engine.handle(STAR_INIT);
		settle(engine);
		const leafBefore = positionOf(sent, 1);
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 400, y: 250, z: 0 });
		stepTimes(engine, 6);
		engine.handle({ type: "drag-end" });
		stepTimes(engine, 700);
		const hub = positionOf(sent, 0);
		const leaf = positionOf(sent, 1);
		expect(hub[0]).toBeCloseTo(400, 3);
		expect(Math.hypot(leaf[0] - leafBefore[0], leaf[1] - leafBefore[1])).toBeGreaterThan(350);
	});
});

describe("dragging with physics disabled", () => {
	const DISABLED_PARAMS: PhysicsParams = { ...BASE_PARAMS, disabled: true };

	test("only the grabbed node moves and a frame is still emitted", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle({ type: "params", params: DISABLED_PARAMS });
		engine.handle(STAR_INIT); // disabled physics posts the seed frame outright
		const leafBefore = positionOf(sent, 1);

		// Act
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 700, y: 700, z: 0 });

		// Assert: the drag repaints even though the simulation never ticks
		const [x, y] = positionOf(sent, 0);
		expect(x).toBe(700);
		expect(y).toBe(700);
		expect(positionOf(sent, 1)).toEqual(leafBefore);
	});

	test("release posts a final frame so positions get persisted", () => {
		const { engine, sent } = makeEngine();
		engine.handle({ type: "params", params: DISABLED_PARAMS });
		engine.handle(STAR_INIT);
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 12, y: 34, z: 0 });

		engine.handle({ type: "drag-end" });

		const end = sent.filter((m) => m.type === "end");
		expect(end).toHaveLength(1);
		expect(end[0].positions[0]).toBe(12);
		expect(end[0].positions[1]).toBe(34);
	});
});

describe("dragging a static layout", () => {
	test("the grabbed node moves while the frozen shape holds", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle({ ...STAR_INIT, static: true });
		const leafBefore = positionOf(sent, 1);

		// Act
		engine.handle({ type: "drag-start", id: 0 });
		engine.handle({ type: "drag-move", id: 0, x: 250, y: 250, z: 0 });
		stepTimes(engine, 20);

		// Assert
		const [x, y] = positionOf(sent, 0);
		expect(x).toBeCloseTo(250, 3);
		expect(y).toBeCloseTo(250, 3);
		expect(positionOf(sent, 1)[0]).toBeCloseTo(leafBefore[0], 3);
	});
});

describe("drag on an unknown node", () => {
	test("an out-of-range id is ignored rather than throwing", () => {
		const { engine } = makeEngine();
		engine.handle(STAR_INIT);

		expect(() => {
			engine.handle({ type: "drag-start", id: 99 });
			engine.handle({ type: "drag-move", id: 99, x: 1, y: 1, z: 1 });
			engine.handle({ type: "drag-end" });
			engine.handle({ type: "unpin", id: 99 });
		}).not.toThrow();
	});
});
