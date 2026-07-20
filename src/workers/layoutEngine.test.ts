import { describe, expect, test, vi } from "vitest";
import { createLayoutEngine, type EngineOutMessage } from "./layoutEngine";

function makeEngine() {
	const sent: EngineOutMessage[] = [];
	const engine = createLayoutEngine((message) => sent.push(message));
	return { engine, sent };
}

const TWO_NODE_INIT = {
	type: "init" as const,
	nodeCount: 2,
	edges: new Uint32Array([0, 1]),
	weights: new Float32Array([1]),
	paused: true,
};

describe("layout engine protocol", () => {
	test("step after init posts positions for every node", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle(TWO_NODE_INIT);

		// Act
		engine.handle({ type: "step" });

		// Assert
		const tick = sent.find((m) => m.type === "tick");
		expect(tick).toBeDefined();
		expect(tick!.positions).toHaveLength(6); // x,y,z per node
		expect(Array.from(tick!.positions).every(Number.isFinite)).toBe(true);
	});

	test("linked nodes are pulled closer over many steps", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle({
			type: "init",
			nodeCount: 3,
			edges: new Uint32Array([0, 1]), // node 2 is free-floating
			weights: new Float32Array([1]),
			paused: true,
		});

		// Act
		for (let i = 0; i < 300; i++) engine.handle({ type: "step" });

		// Assert
		const last = sent.filter((m) => m.type === "tick").pop()!;
		const p = last.positions;
		const linkedDistance = Math.hypot(p[3] - p[0], p[4] - p[1]);
		const freeDistance = Math.hypot(p[6] - p[0], p[7] - p[1]);
		expect(linkedDistance).toBeLessThan(freeDistance);
	});

	test("pinned node keeps its coordinates while stepping", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle(TWO_NODE_INIT);

		// Act
		engine.handle({ type: "pin", id: 0, x: 42, y: -7 });
		for (let i = 0; i < 20; i++) engine.handle({ type: "step" });

		// Assert
		const last = sent.filter((m) => m.type === "tick").pop()!;
		expect(last.positions[0]).toBeCloseTo(42);
		expect(last.positions[1]).toBeCloseTo(-7);
	});

	test("posts end message once alpha decays below threshold", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle(TWO_NODE_INIT);

		// Act: far more steps than d3-force needs to cool down
		for (let i = 0; i < 1000; i++) engine.handle({ type: "step" });

		// Assert
		expect(sent.some((m) => m.type === "end")).toBe(true);
	});

	test("stop halts stepping", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		engine.handle(TWO_NODE_INIT);
		engine.handle({ type: "step" });
		const countAfterFirstStep = sent.length;

		// Act
		engine.handle({ type: "stop" });
		engine.handle({ type: "step" });

		// Assert
		expect(sent.length).toBe(countAfterFirstStep);
	});

	test("init seeds positions from a provided buffer", () => {
		// Arrange
		const { engine, sent } = makeEngine();
		const seed = new Float32Array([10, 20, 0, 30, 40, 0]);

		// Act
		engine.handle({ ...TWO_NODE_INIT, positions: seed });
		engine.handle({ type: "step" });

		// Assert: after one step positions stay near the seed (forces at alpha=1
		// can move a node several units), not at default phyllotaxis spots
		const tick = sent.find((m) => m.type === "tick")!;
		expect(Math.abs(tick.positions[0] - 10)).toBeLessThan(15);
		expect(Math.abs(tick.positions[3] - 30)).toBeLessThan(15);
	});

	test("timers are not used when paused", () => {
		// Arrange
		vi.useFakeTimers();
		const { engine, sent } = makeEngine();

		// Act
		engine.handle(TWO_NODE_INIT);
		vi.advanceTimersByTime(1000);

		// Assert: no automatic ticks in paused mode
		expect(sent.filter((m) => m.type === "tick")).toHaveLength(0);
		vi.useRealTimers();
	});
});
