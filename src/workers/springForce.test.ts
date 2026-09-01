import { describe, expect, it } from "vitest";
import { createSpringForce, type SpringNode } from "./springForce";

/** Advances one d3-style step: forces wrote velocities, now apply them. */
function integrate(nodes: SpringNode[], decay = 0.4): void {
	for (const n of nodes) {
		n.vx = (n.vx ?? 0) * (1 - decay);
		n.vy = (n.vy ?? 0) * (1 - decay);
		n.x = (n.x ?? 0) + (n.vx ?? 0);
		n.y = (n.y ?? 0) + (n.vy ?? 0);
	}
}

function pair(distance: number): SpringNode[] {
	return [
		{ id: 0, x: 0, y: 0, vx: 0, vy: 0 },
		{ id: 1, x: distance, y: 0, vx: 0, vy: 0 },
	];
}

const LINK = [{ source: 0, target: 1, weight: 1 }];

describe("createSpringForce", () => {
	it("pulls a stretched edge back together", () => {
		// Arrange
		const nodes = pair(100);
		const force = createSpringForce();
		force.initialize(nodes);
		force.setLinks(LINK);
		force.setParams({ stiffness: 0.2, restLength: 40, damping: 0.3 });

		// Act
		force(1);

		// Assert — they close on each other
		expect(nodes[0].vx).toBeGreaterThan(0);
		expect(nodes[1].vx).toBeLessThan(0);
	});

	it("pushes a compressed edge apart", () => {
		// Arrange
		const nodes = pair(10);
		const force = createSpringForce();
		force.initialize(nodes);
		force.setLinks(LINK);
		force.setParams({ stiffness: 0.2, restLength: 40, damping: 0.3 });

		// Act
		force(1);

		// Assert
		expect(nodes[0].vx).toBeLessThan(0);
		expect(nodes[1].vx).toBeGreaterThan(0);
	});

	it("leaves an edge already at rest length alone", () => {
		// Arrange
		const nodes = pair(40);
		const force = createSpringForce();
		force.initialize(nodes);
		force.setLinks(LINK);
		force.setParams({ stiffness: 0.2, restLength: 40, damping: 0.3 });

		// Act
		force(1);

		// Assert
		expect(nodes[0].vx).toBeCloseTo(0, 6);
		expect(nodes[1].vx).toBeCloseTo(0, 6);
	});

	it("converges to rest length when damped", () => {
		// Arrange
		const nodes = pair(150);
		const force = createSpringForce();
		force.initialize(nodes);
		force.setLinks(LINK);
		force.setParams({ stiffness: 0.15, restLength: 40, damping: 0.6 });

		// Act
		for (let i = 0; i < 400; i++) {
			force(1);
			integrate(nodes);
		}

		// Assert
		expect(nodes[1].x! - nodes[0].x!).toBeCloseTo(40, 0);
	});

	it("overshoots rest length when damping is low — the rubber-band snap", () => {
		// Arrange
		const nodes = pair(150);
		const force = createSpringForce();
		force.initialize(nodes);
		force.setLinks(LINK);
		force.setParams({ stiffness: 0.5, restLength: 40, damping: 0 });

		// Act — record the closest the two ever get
		let minDistance = Infinity;
		for (let i = 0; i < 200; i++) {
			force(1);
			integrate(nodes, 0.02);
			minDistance = Math.min(minDistance, Math.abs(nodes[1].x! - nodes[0].x!));
		}

		// Assert — it sailed past rest length instead of easing onto it
		expect(minDistance).toBeLessThan(40);
	});

	it("survives two nodes sitting on the exact same point", () => {
		// Arrange
		const nodes = pair(0);
		const force = createSpringForce();
		force.initialize(nodes);
		force.setLinks(LINK);
		force.setParams({ stiffness: 0.2, restLength: 40, damping: 0.3 });

		// Act
		force(1);

		// Assert
		expect(Number.isFinite(nodes[0].vx!)).toBe(true);
		expect(Number.isFinite(nodes[1].vx!)).toBe(true);
	});

	it("does nothing with no links", () => {
		// Arrange
		const nodes = pair(100);
		const force = createSpringForce();
		force.initialize(nodes);
		force.setParams({ stiffness: 0.2, restLength: 40, damping: 0.3 });

		// Act
		force(1);

		// Assert
		expect(nodes[0].vx).toBe(0);
		expect(nodes[1].vx).toBe(0);
	});

	it("scales the pull with alpha so a cooling layout calms down", () => {
		// Arrange
		const hot = pair(100);
		const cold = pair(100);
		const hotForce = createSpringForce();
		const coldForce = createSpringForce();
		for (const [force, nodes] of [[hotForce, hot], [coldForce, cold]] as const) {
			force.initialize(nodes);
			force.setLinks(LINK);
			force.setParams({ stiffness: 0.2, restLength: 40, damping: 0.3 });
		}

		// Act
		hotForce(1);
		coldForce(0.1);

		// Assert
		expect(hot[0].vx!).toBeGreaterThan(cold[0].vx!);
	});

	it("softens the pull on a high-degree node so hubs stay stable", () => {
		// Arrange — same stretched edge, but node 0 is a 20-link hub.
		const plain = pair(100);
		const hubbed = pair(100);
		const plainForce = createSpringForce();
		const hubForce = createSpringForce();
		for (const [force, nodes] of [[plainForce, plain], [hubForce, hubbed]] as const) {
			force.initialize(nodes);
			force.setLinks(LINK);
			force.setParams({ stiffness: 0.2, restLength: 40, damping: 0.3 });
		}
		hubForce.setDegrees(new Int32Array([20, 1]));

		// Act
		plainForce(1);
		hubForce(1);

		// Assert — the hub barely budges, its leaf partner still swings fully
		expect(hubbed[0].vx!).toBeLessThan(plain[0].vx!);
		expect(hubbed[1].vx!).toBeCloseTo(plain[1].vx!, 6);
	});

	it("moves nodes on a 3D edge along z too", () => {
		// Arrange
		const nodes: SpringNode[] = [
			{ id: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
			{ id: 1, x: 0, y: 0, z: 100, vx: 0, vy: 0, vz: 0 },
		];
		const force = createSpringForce();
		force.initialize(nodes);
		force.setLinks(LINK);
		force.setParams({ stiffness: 0.2, restLength: 40, damping: 0.3 });

		// Act
		force(1);

		// Assert
		expect(nodes[0].vz).toBeGreaterThan(0);
		expect(nodes[1].vz).toBeLessThan(0);
	});
});
