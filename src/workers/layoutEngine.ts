/**
 * Force layout engine that runs inside layout.worker.ts. Pure module (no
 * worker globals) so the message protocol is unit-testable on the main thread.
 */
import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	forceZ,
	type Simulation3D,
	type SimulationNodeDatum3D,
} from "d3-force-3d";
import { computeLayoutSeed } from "./layoutSeed";
import { createSpringForce, type SpringLink } from "./springForce";
import { nextTickDelay } from "./tickPacing";
import { SETTLED_THETA, repulsionTheta } from "./repulsionAccuracy";

/** Monotonic where available; `performance` is absent in some test contexts. */
const now = (): number =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

interface SimNode extends SimulationNodeDatum3D {
	id: number;
}

/** Which attraction rule shapes the layout: by links (default), or by pulling
 *  notes that share a tag, folder, community, creation year, edit-recency
 *  bucket or connectivity tier into the same cluster. */
export type LayoutRule = "links" | "tags" | "folders" | "cluster" | "age" | "recency" | "hubs";

interface ClusterForce {
	(alpha: number): void;
	initialize(nodes: SimNode[]): void;
	setGroups(groups: Int32Array | null): void;
	setStrength(strength: number): void;
}

/** Custom d3 force: nudges every node toward the centroid of its group so that
 *  same-tag / same-folder notes gather into clumps. Group id < 0 = ungrouped. */
function createClusterForce(): ClusterForce {
	let nodes: SimNode[] = [];
	let groups: Int32Array | null = null;
	let strength = 0.12;

	const force = ((alpha: number) => {
		if (!groups) return;
		const sumX = new Map<number, number>();
		const sumY = new Map<number, number>();
		const sumZ = new Map<number, number>();
		const count = new Map<number, number>();
		for (const n of nodes) {
			const g = groups[n.id];
			if (g < 0) continue;
			sumX.set(g, (sumX.get(g) ?? 0) + (n.x ?? 0));
			sumY.set(g, (sumY.get(g) ?? 0) + (n.y ?? 0));
			sumZ.set(g, (sumZ.get(g) ?? 0) + (n.z ?? 0));
			count.set(g, (count.get(g) ?? 0) + 1);
		}
		const k = strength * alpha;
		for (const n of nodes) {
			const g = groups[n.id];
			if (g < 0) continue;
			const c = count.get(g) ?? 0;
			if (c < 2) continue;
			n.vx = (n.vx ?? 0) + ((sumX.get(g)! / c) - (n.x ?? 0)) * k;
			n.vy = (n.vy ?? 0) + ((sumY.get(g)! / c) - (n.y ?? 0)) * k;
			if (n.z !== undefined) n.vz = (n.vz ?? 0) + ((sumZ.get(g)! / c) - (n.z ?? 0)) * k;
		}
	}) as ClusterForce;

	force.initialize = (n: SimNode[]) => { nodes = n; };
	force.setGroups = (g: Int32Array | null) => { groups = g; };
	force.setStrength = (s: number) => { strength = s; };
	return force;
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
	/** Freeze every node at its seed position — a static shape (circle/grid)
	 *  that holds instead of relaxing into a cloud. Dragging still works. */
	static?: boolean;
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
	/** 0 = inert, 1 = springy: links pull back with extra strength and the
	 *  layout keeps a little residual heat so it visibly rebounds. */
	elasticity: number;
	/** true = no repulsion range cap and light centering: nodes spread freely
	 *  instead of packing into round geometric clumps. */
	freeLayout: boolean;
	/** Hard minimum spacing between node centers (world units). Grows with node
	 *  size so big nodes push apart instead of overlapping. 0 = off. */
	collideRadius?: number;
	/** true = freeze the layout: no simulation runs, nodes stay put, and a drag
	 *  moves only the grabbed node. */
	disabled?: boolean;
}

export type EngineInMessage =
	| InitMessage
	| { type: "params"; params: PhysicsParams }
	| { type: "step" }
	| { type: "stop" }
	| { type: "reheat"; alpha?: number }
	| { type: "cluster"; groups: Int32Array | null; strength?: number }
	| { type: "drag-start"; id: number }
	| { type: "drag-move"; id: number; x: number; y: number; z?: number }
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
// 30 Hz: settle animation stays smooth while halving main-thread work
// (sprite sync + edge rewrite + cull run per received tick).
const FRAME_INTERVAL_MS = 33;
const DRAG_INTERVAL_MS = 16;
// Dragging keeps the real physics running (like Obsidian): the grabbed node is
// pinned to the pointer, links tow its neighbors, and the tow propagates hop by
// hop. Forces are left at their settle values (no boost, no centering change),
// so re-warming returns to the same equilibrium — the graph doesn't contract.
// Only a gentle warmth is added, ramped via alphaTarget, so grabbing a settled
// graph never jerks it.
const DRAG_ALPHA_TARGET = 0.3;
/** Small immediate warmth on grab so the tow responds without waiting for the
 *  alphaTarget ramp — kept low enough to not visibly kick the graph. */
const DRAG_GRAB_ALPHA = 0.12;
// Tuned for compactness: bounded-range repulsion + noticeable centering,
// otherwise sparse vaults explode into a huge sparse cloud.
const CENTERING_STRENGTH = 0.04;
const CHARGE_STRENGTH = -50;
const CHARGE_MAX_DISTANCE = 300;
const LINK_DISTANCE = 40;

/** Converts the link-strength slider into spring stiffness. Tuned so that at
 *  the default elasticity the spring plus the leftover forceLink add up to
 *  roughly the tension the old formula produced — the slider keeps its feel. */
const SPRING_GAIN = 2.5;
/** Edge damping at elasticity 0 …and at elasticity 1. Low damping is what
 *  makes a stretched edge sail past its rest length and snap back. */
const SPRING_DAMPING_INERT = 0.9;
const SPRING_DAMPING_BOUNCY = 0.15;
/** Velocity damping used only while a node is being dragged. Lower friction
 *  lets the tow travel two or three hops out instead of dying on the first
 *  neighbor. It changes how fast equilibrium is reached, never where it is,
 *  so the graph does not contract on grab. */
const DRAG_VELOCITY_DECAY = 0.35;

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
		elasticity: 0.4,
		freeLayout: false,
		collideRadius: 0,
	};
	let running = false;
	let timer: number | null = null;
	/** Target period of the running timer, or null when stopped. */
	let tickInterval: number | null = null;
	/** Cost of the previous tick, feeding the pacing of the next one. */
	let lastTickMs: number | null = null;
	// Cluster-by-group attraction, persisted across re-inits.
	const cluster = createClusterForce();
	let clusterGroups: Int32Array | null = null;
	// Hooke springs on the edges; blended against forceLink by `elasticity`.
	const spring = createSpringForce();
	// true = physics off (the "Отключить физику" toggle): sim never ticks.
	let physicsDisabled = false;

	// `elasticity` crossfades between two ways of holding an edge together.
	// At 0 it is pure forceLink: a positional constraint that slides endpoints
	// onto the rest distance and stops dead. As it rises, forceLink hands over
	// to a real spring that overshoots and rebounds — the rubber-band feel.
	const effectiveLinkStrength = () =>
		params.linkStrength * (1 - params.elasticity);

	const applySpringParams = () => {
		spring.setParams({
			stiffness: params.linkStrength * params.elasticity * SPRING_GAIN,
			restLength: params.linkDistance,
			damping:
				SPRING_DAMPING_INERT +
				(SPRING_DAMPING_BOUNCY - SPRING_DAMPING_INERT) * params.elasticity,
		});
	};

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

	// Bare setTimeout, not window.setTimeout: this module runs inside a Web
	// Worker, where `window` does not exist at all — the usual Obsidian advice
	// about popout windows does not apply here and would break the worker. The
	// bare form also resolves under the test runner, which keeps the drag/tow
	// protocol unit-testable off the main thread.
	const stopTimer = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		tickInterval = null;
		lastTickMs = null;
	};

	/** Chains the next tick, pacing it by what the previous one actually cost. */
	const scheduleTick = () => {
		if (tickInterval === null) return;
		timer = setTimeout(pacedStep, nextTickDelay(tickInterval, lastTickMs));
	};

	const startTimer = (intervalMs: number) => {
		stopTimer();
		running = true;
		tickInterval = intervalMs;
		// First tick goes out on the full interval; later ones adapt.
		lastTickMs = null;
		scheduleTick();
	};

	/** One tick plus its own re-scheduling. `stepOnce` stays timer-free so the
	 *  "step" message can drive a single tick in tests and benchmarks. */
	const pacedStep = () => {
		timer = null;
		const startedAt = now();
		stepOnce();
		lastTickMs = now() - startedAt;
		// stepOnce may have settled the layout and cleared the interval.
		if (running) scheduleTick();
	};

	const stepOnce = () => {
		if (!simulation || !running) return;
		// Repulsion accuracy tracks how hot the layout is: cheap while nodes are
		// still flying, exact by the time they come to rest.
		(simulation.force("charge") as ReturnType<typeof forceManyBody>)
			.theta(repulsionTheta(simulation.alpha()));
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

		// No carried-over seed? Scatter nodes into a cloud rather than leaving
		// them position-less: d3-force would otherwise seed a phyllotaxis
		// spiral that survives as a visible fractal in sparse graphs.
		const positions = message.positions ?? computeLayoutSeed("scatter", message.nodeCount);

		// A seed carried over from a 2D layout has z=0 everywhere. That is an
		// unstable equilibrium: symmetric forces keep the layout a flat disc
		// forever, and a rotating disc reads as a "tube". Detect flat seeds
		// and scatter z deterministically so the simulation inflates into a
		// real ball.
		let flatSeed = true;
		if (dimensions === 3) {
			// Compare z spread against xy spread: a few stray z values must
			// not fool the detector — a QUASI-flat pancake still collapses
			// into a rotating "tube" without a proper z scatter.
			let maxAbsZ = 0;
			let maxAbsXY = 1;
			for (let i = 0; i < message.nodeCount; i++) {
				const az = Math.abs(positions[i * 3 + 2]);
				if (az > maxAbsZ) maxAbsZ = az;
				const ax = Math.abs(positions[i * 3]);
				const ay = Math.abs(positions[i * 3 + 1]);
				if (ax > maxAbsXY) maxAbsXY = ax;
				if (ay > maxAbsXY) maxAbsXY = ay;
			}
			flatSeed = maxAbsZ < Math.max(20, maxAbsXY * 0.1);
		}

		nodes = [];
		for (let i = 0; i < message.nodeCount; i++) {
			const node: SimNode = { id: i };
			node.x = positions[i * 3];
			node.y = positions[i * 3 + 1];
			if (dimensions === 3) {
				node.z = flatSeed
					? ((i * 2654435761 % 200000) / 1000 - 100) // ±100, deterministic
					: positions[i * 3 + 2];
			}
			nodes.push(node);
		}

		// Two separate arrays on purpose: d3's forceLink rewrites `source` and
		// `target` in place, swapping the numeric ids for node objects. The
		// spring indexes `nodes` by id, so it needs an untouched copy.
		const links = [];
		const springLinks: SpringLink[] = [];
		const degrees = new Int32Array(message.nodeCount);
		for (let e = 0; e < message.weights.length; e++) {
			const source = message.edges[e * 2];
			const target = message.edges[e * 2 + 1];
			const weight = message.weights[e];
			links.push({ source, target, weight });
			springLinks.push({ source, target, weight });
			degrees[source]++;
			degrees[target]++;
		}
		spring.setLinks(springLinks);
		spring.setDegrees(degrees);
		applySpringParams();

		simulation = forceSimulation(nodes, dimensions)
			.force(
				"charge",
				forceManyBody()
					// Starting point only; stepOnce paces this against alpha.
					.theta(SETTLED_THETA)
					.strength(-params.repel)
					.distanceMax(params.freeLayout ? Infinity : CHARGE_MAX_DISTANCE)
			)
			.force(
				"link",
				forceLink(links)
					.id((d) => (d as SimNode).id)
					.distance(params.linkDistance)
					.strength(effectiveLinkStrength())
			)
			.force("x", forceX(0).strength(effectiveCentering()))
			.force("y", forceY(0).strength(effectiveCentering()))
			.force("z", dimensions === 3 ? forceZ(0).strength(effectiveCentering()) : null)
			.force("collide", forceCollide(params.collideRadius ?? 0).strength(0.7))
			.force("spring", spring)
			.force("cluster", cluster)
			.alphaMin(ALPHA_MIN)
			.velocityDecay(params.velocityDecay)
			.stop(); // stepping is driven by our own timer, never d3-timer
		cluster.setGroups(clusterGroups);

		if (message.static) {
			// Pin every node at its seed so the shape holds. Dragging one node
			// still moves it (drag-start starts the timer); the rest stay put,
			// so a static layout never vibrates.
			for (const node of nodes) {
				node.fx = node.x;
				node.fy = node.y;
				if (dimensions === 3) node.fz = node.z;
			}
			const positions = snapshotPositions();
			post({ type: "tick", positions, alpha: 0 }, [positions.buffer]);
			const settled = snapshotPositions();
			post({ type: "end", positions: settled }, [settled.buffer]);
			running = false;
			return;
		}

		// Physics disabled: show the seed layout and never tick.
		physicsDisabled = !!params.disabled;
		if (physicsDisabled) {
			const positions = snapshotPositions();
			post({ type: "tick", positions, alpha: 0 }, [positions.buffer]);
			running = false;
			return;
		}

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
					// Physics on/off toggle: stop the sim when disabled, resume
					// (gentle reheat) when re-enabled.
					const wasDisabled = physicsDisabled;
					physicsDisabled = !!params.disabled;
					if (physicsDisabled) {
						running = false;
						stopTimer();
					} else if (wasDisabled && simulation) {
						simulation.alpha(Math.max(simulation.alpha(), 0.3));
						if (!running) startTimer(FRAME_INTERVAL_MS);
					}
					if (simulation) {
						(simulation.force("charge") as ReturnType<typeof forceManyBody>)
							.strength(-params.repel)
							.distanceMax(params.freeLayout ? Infinity : CHARGE_MAX_DISTANCE);
						(simulation.force("link") as ReturnType<typeof forceLink>)
							.distance(params.linkDistance)
							.strength(effectiveLinkStrength());
						simulation.velocityDecay(params.velocityDecay);
						(simulation.force("x") as ReturnType<typeof forceX>).strength(effectiveCentering());
						(simulation.force("y") as ReturnType<typeof forceY>).strength(effectiveCentering());
						const zForce = simulation.force("z") as ReturnType<typeof forceZ> | null;
						if (zForce) zForce.strength(effectiveCentering());
						(simulation.force("collide") as ReturnType<typeof forceCollide>)
							.radius(params.collideRadius ?? 0);
						applySpringParams();
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
				case "cluster":
					clusterGroups = message.groups;
					cluster.setGroups(clusterGroups);
					if (message.strength !== undefined) cluster.setStrength(message.strength);
					if (simulation) {
						simulation.alpha(Math.max(simulation.alpha(), 0.6));
						if (!running) startTimer(FRAME_INTERVAL_MS);
					}
					break;
				case "reheat":
					if (simulation) {
						simulation.alpha(message.alpha ?? 0.5);
						if (!running) startTimer(FRAME_INTERVAL_MS);
					}
					break;
				case "drag-start": {
					const node = nodes[message.id];
					if (node) {
						node.fx = node.x ?? 0;
						node.fy = node.y ?? 0;
						if (node.z !== undefined) node.fz = node.z;
					}
					if (physicsDisabled || !simulation) break;
					// Keep the real sim running: pin the node, add a little warmth
					// (ramped, so no jerk). Links tow neighbors and the tow spreads
					// hop by hop. Forces stay at settle values — no contraction.
					simulation.alphaTarget(DRAG_ALPHA_TARGET);
					if (simulation.alpha() < DRAG_GRAB_ALPHA) simulation.alpha(DRAG_GRAB_ALPHA);
					// Ease off the friction so the tow reaches past the first hop.
					simulation.velocityDecay(
						Math.min(params.velocityDecay, DRAG_VELOCITY_DECAY)
					);
					if (!running) startTimer(DRAG_INTERVAL_MS);
					break;
				}
				case "drag-move": {
					const node = nodes[message.id];
					if (!node) break;
					node.fx = message.x;
					node.fy = message.y;
					if (message.z !== undefined) node.fz = message.z;
					if (physicsDisabled || !simulation) {
						// No physics: just reposition the grabbed node and repaint.
						node.x = message.x;
						node.y = message.y;
						if (message.z !== undefined) node.z = message.z;
						const positions = snapshotPositions();
						post({ type: "tick", positions, alpha: 0 }, [positions.buffer]);
					}
					break;
				}
				case "drag-end": {
					if (physicsDisabled || !simulation) {
						const positions = snapshotPositions();
						post({ type: "end", positions }, [positions.buffer]);
						break;
					}
					// Stop warming and let the sim cool where it is — no rebound.
					simulation.alphaTarget(0);
					simulation.velocityDecay(params.velocityDecay);
					break;
				}
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
