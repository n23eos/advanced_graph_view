/**
 * Force layout engine that runs inside layout.worker.ts. Pure module (no
 * worker globals) so the message protocol is unit-testable on the main thread.
 */
import {
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	forceZ,
	type Simulation3D,
	type SimulationNodeDatum3D,
} from "d3-force-3d";

interface SimNode extends SimulationNodeDatum3D {
	id: number;
}

export interface InitMessage {
	type: "init";
	nodeCount: number;
	/** Flat [source0, target0, source1, target1, ...] pairs. */
	edges: Uint32Array;
	weights: Float32Array;
	/** Seed positions [x0, y0, z0, x1, y1, z1, ...] from a previous session. */
	positions?: Float32Array;
	/** 2 = flat layout (z stays 0), 3 = spherical 3D layout. */
	dimensions?: 2 | 3;
	/** When true the engine only advances on explicit "step" messages (tests, debugging). */
	paused?: boolean;
}

export interface PhysicsParams {
	/** Absolute repulsion strength (positive number, applied as negative). */
	repel: number;
	linkDistance: number;
	centering: number;
	/** Uniform link spring strength 0..1 (native graph's "link force"). */
	linkStrength: number;
	/** Velocity damping 0.1..0.9 — higher = smoother, slower motion. */
	velocityDecay: number;
	/** true = no repulsion range cap and light centering: nodes spread freely
	 *  instead of packing into round geometric clumps. */
	freeLayout: boolean;
}

export type EngineInMessage =
	| InitMessage
	| { type: "params"; params: PhysicsParams }
	| { type: "step" }
	| { type: "stop" }
	| { type: "reheat" }
	| { type: "drag-start" }
	| { type: "drag-end" }
	| { type: "pin"; id: number; x: number; y: number; z?: number }
	| { type: "unpin"; id: number };

export type EngineOutMessage =
	| { type: "tick"; positions: Float32Array; alpha: number }
	| { type: "end"; positions: Float32Array };

export interface LayoutEngine {
	handle(message: EngineInMessage): void;
}

const ALPHA_MIN = 0.01;
const BARNES_HUT_THETA = 0.9;
// 30 Hz: settle animation stays smooth while halving main-thread work
// (sprite sync + edge rewrite + cull run per received tick).
const FRAME_INTERVAL_MS = 33;
// While dragging: full-rate ticks + a warm alphaTarget so neighbors follow
// the pointer live instead of the sluggish cooled-down crawl. The target is
// kept LOW and damping is raised, otherwise coarse Barnes-Hut repulsion
// noise makes the neighborhood visibly vibrate; with strong damping the
// pull propagates as a smooth cascade that fades with graph distance.
const DRAG_INTERVAL_MS = 16;
const DRAG_ALPHA_TARGET = 0.08;
const DRAG_EXTRA_DAMPING = 0.25;
const MAX_DRAG_DAMPING = 0.8;
// Tuned for compactness: bounded-range repulsion + noticeable centering,
// otherwise sparse vaults explode into a huge sparse cloud.
const CENTERING_STRENGTH = 0.04;
const CHARGE_STRENGTH = -50;
const CHARGE_MAX_DISTANCE = 300;
const LINK_DISTANCE = 40;

/** Big graphs need proportionally weaker centering or they collapse into
 *  a solid blob: pull must balance repulsion over a sqrt(N)-sized radius. */
function scaledCentering(base: number, nodeCount: number): number {
	return base * Math.sqrt(1500 / Math.max(nodeCount, 1500));
}

export function createLayoutEngine(
	post: (message: EngineOutMessage, transfer?: Transferable[]) => void
): LayoutEngine {
	let simulation: Simulation3D<SimNode> | null = null;
	let nodes: SimNode[] = [];
	let params: PhysicsParams = {
		repel: -CHARGE_STRENGTH,
		linkDistance: LINK_DISTANCE,
		centering: CENTERING_STRENGTH,
		linkStrength: 0.4,
		velocityDecay: 0.4,
		freeLayout: false,
	};
	let running = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	const effectiveCentering = () => {
		const scaled = scaledCentering(params.centering, nodes.length);
		return params.freeLayout ? scaled * 0.3 : scaled;
	};

	// Positions always travel as xyz; in 2D mode z is simply 0.
	const snapshotPositions = (): Float32Array => {
		const positions = new Float32Array(nodes.length * 3);
		for (let i = 0; i < nodes.length; i++) {
			positions[i * 3] = nodes[i].x ?? 0;
			positions[i * 3 + 1] = nodes[i].y ?? 0;
			positions[i * 3 + 2] = nodes[i].z ?? 0;
		}
		return positions;
	};

	const stopTimer = () => {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	};

	const startTimer = (intervalMs: number) => {
		stopTimer();
		running = true;
		timer = setInterval(stepOnce, intervalMs);
	};

	const stepOnce = () => {
		if (!simulation || !running) return;
		simulation.tick();
		const positions = snapshotPositions();
		post({ type: "tick", positions, alpha: simulation.alpha() }, [positions.buffer]);
		if (simulation.alpha() < ALPHA_MIN) {
			running = false;
			stopTimer();
			const finalPositions = snapshotPositions();
			post({ type: "end", positions: finalPositions }, [finalPositions.buffer]);
		}
	};

	const init = (message: InitMessage) => {
		stopTimer();
		const dimensions = message.dimensions ?? 2;

		// A seed carried over from a 2D layout has z=0 everywhere. That is an
		// unstable equilibrium: symmetric forces keep the layout a flat disc
		// forever, and a rotating disc reads as a "tube". Detect flat seeds
		// and scatter z deterministically so the simulation inflates into a
		// real ball.
		let flatSeed = true;
		if (dimensions === 3 && message.positions) {
			// Compare z spread against xy spread: a few stray z values must
			// not fool the detector — a QUASI-flat pancake still collapses
			// into a rotating "tube" without a proper z scatter.
			let maxAbsZ = 0;
			let maxAbsXY = 1;
			for (let i = 0; i < message.nodeCount; i++) {
				const az = Math.abs(message.positions[i * 3 + 2]);
				if (az > maxAbsZ) maxAbsZ = az;
				const ax = Math.abs(message.positions[i * 3]);
				const ay = Math.abs(message.positions[i * 3 + 1]);
				if (ax > maxAbsXY) maxAbsXY = ax;
				if (ay > maxAbsXY) maxAbsXY = ay;
			}
			flatSeed = maxAbsZ < Math.max(20, maxAbsXY * 0.1);
		}

		nodes = [];
		for (let i = 0; i < message.nodeCount; i++) {
			const node: SimNode = { id: i };
			if (message.positions) {
				node.x = message.positions[i * 3];
				node.y = message.positions[i * 3 + 1];
				if (dimensions === 3) {
					node.z = flatSeed
						? ((i * 2654435761 % 200000) / 1000 - 100) // ±100, deterministic
						: message.positions[i * 3 + 2];
				}
			}
			nodes.push(node);
		}

		const links = [];
		for (let e = 0; e < message.weights.length; e++) {
			links.push({
				source: message.edges[e * 2],
				target: message.edges[e * 2 + 1],
				weight: message.weights[e],
			});
		}

		simulation = forceSimulation(nodes, dimensions)
			.force(
				"charge",
				forceManyBody()
					.theta(BARNES_HUT_THETA)
					.strength(-params.repel)
					.distanceMax(params.freeLayout ? Infinity : CHARGE_MAX_DISTANCE)
			)
			.force(
				"link",
				forceLink(links)
					.id((d) => (d as SimNode).id)
					.distance(params.linkDistance)
					.strength(params.linkStrength)
			)
			.force("x", forceX(0).strength(effectiveCentering()))
			.force("y", forceY(0).strength(effectiveCentering()))
			.force("z", dimensions === 3 ? forceZ(0).strength(effectiveCentering()) : null)
			.alphaMin(ALPHA_MIN)
			.velocityDecay(params.velocityDecay)
			.stop(); // stepping is driven by our own timer, never d3-timer

		running = true;
		if (!message.paused) {
			startTimer(FRAME_INTERVAL_MS);
		}
	};

	return {
		handle(message: EngineInMessage): void {
			switch (message.type) {
				case "init":
					init(message);
					break;
				case "params": {
					params = message.params;
					if (simulation) {
						(simulation.force("charge") as ReturnType<typeof forceManyBody>)
							.strength(-params.repel)
							.distanceMax(params.freeLayout ? Infinity : CHARGE_MAX_DISTANCE);
						(simulation.force("link") as ReturnType<typeof forceLink>)
							.distance(params.linkDistance)
							.strength(params.linkStrength);
						simulation.velocityDecay(params.velocityDecay);
						(simulation.force("x") as ReturnType<typeof forceX>).strength(effectiveCentering());
						(simulation.force("y") as ReturnType<typeof forceY>).strength(effectiveCentering());
						const zForce = simulation.force("z") as ReturnType<typeof forceZ> | null;
						if (zForce) zForce.strength(effectiveCentering());
					}
					break;
				}
				case "step":
					stepOnce();
					break;
				case "stop":
					running = false;
					stopTimer();
					break;
				case "reheat":
					if (simulation) {
						simulation.alpha(0.5);
						if (!running) startTimer(FRAME_INTERVAL_MS);
					}
					break;
				case "drag-start":
					if (simulation) {
						simulation.alphaTarget(DRAG_ALPHA_TARGET);
						if (simulation.alpha() < DRAG_ALPHA_TARGET) simulation.alpha(DRAG_ALPHA_TARGET);
						simulation.velocityDecay(
							Math.min(MAX_DRAG_DAMPING, params.velocityDecay + DRAG_EXTRA_DAMPING)
						);
						startTimer(DRAG_INTERVAL_MS);
					}
					break;
				case "drag-end":
					if (simulation) {
						simulation.alphaTarget(0);
						simulation.velocityDecay(params.velocityDecay);
						if (running) startTimer(FRAME_INTERVAL_MS);
					}
					break;
				case "pin": {
					const node = nodes[message.id];
					if (node) {
						node.fx = message.x;
						node.fy = message.y;
						if (message.z !== undefined) node.fz = message.z;
					}
					break;
				}
				case "unpin": {
					const node = nodes[message.id];
					if (node) {
						node.fx = null;
						node.fy = null;
						node.fz = null;
					}
					break;
				}
			}
		},
	};
}
