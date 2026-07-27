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

function makeEngine() {
	const sent: EngineOutMessage[] = [];
	const engine = createLayoutEngine((message) => sent.push(message));
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
