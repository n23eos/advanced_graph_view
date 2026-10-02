import { describe, expect, test, vi } from "vitest";
import { createLayoutEngine, type PhysicsParams } from "./layoutEngine";

const collisionTick = vi.hoisted(() => vi.fn());

vi.mock("d3-force-3d", async (importOriginal) => {
	const original = await importOriginal<typeof import("d3-force-3d")>();
	return {
		...original,
		forceCollide: (radius?: number) => {
			const actual = original.forceCollide(radius);
			const observed: ReturnType<typeof original.forceCollide> = Object.assign(() => {
				collisionTick();
				actual();
			}, {
				initialize: actual.initialize,
				radius: (value: number) => { actual.radius(value); return observed; },
				strength: (value: number) => { actual.strength(value); return observed; },
			});
			return observed;
		},
	};
});

describe("inactive collision work", () => {
	test.each([2, 3] as const)("%iD ticks skip the collision force until spacing is enabled", (dimensions) => {
		collisionTick.mockClear();
		const engine = createLayoutEngine(() => {});
		const params: PhysicsParams = {
			repel: 0, linkDistance: 40, centering: 0, linkStrength: 0,
			velocityDecay: 0.4, elasticity: 0, freeLayout: false, collideRadius: 0,
		};
		engine.handle({
			type: "init", nodeCount: 2, dimensions, paused: true,
			edges: new Uint32Array(), weights: new Float32Array(),
		});
		engine.handle({ type: "params", params });
		engine.handle({ type: "step" });
		expect(collisionTick).not.toHaveBeenCalled();

		engine.handle({ type: "params", params: { ...params, collideRadius: 5 } });
		engine.handle({ type: "step" });
		expect(collisionTick).toHaveBeenCalledTimes(1);

		engine.handle({ type: "params", params });
		engine.handle({ type: "step" });
		expect(collisionTick).toHaveBeenCalledTimes(1);
	});
});
