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

interface SimNode extends SimulationNodeDatum3D {
	id: number;
}

/** Which attraction rule shapes the layout: by links (default), or by pulling
 *  notes that share a tag / folder into the same cluster. */
export type LayoutRule = "links" | "tags" | "folders";

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
// Tighter than d3's loose 0.9 default: accurate repulsion means forces stay
// consistent frame-to-frame, so nodes glide to rest like Obsidian's graph
// instead of buzzing on approximate Barnes-Hut noise.
const BARNES_HUT_THETA = 0.6;
// 30 Hz: settle animation stays smooth while halving main-thread work
// (sprite sync + edge rewrite + cull run per received tick).
const FRAME_INTERVAL_MS = 33;
// While dragging: full-rate ticks + a warm alphaTarget so neighbors follow
// the pointer live instead of the sluggish cooled-down crawl. The target is
// kept LOW and damping is raised, otherwise coarse Barnes-Hut repulsion
// noise makes the neighborhood visibly vibrate; with strong damping the
// pull propagates as a smooth cascade that fades with graph distance.
const DRAG_INTERVAL_MS = 16;
// Lower energy + heavier damping while dragging: the neighborhood follows in a
// smooth glide instead of the coarse Barnes-Hut noise vibrating every node.
const DRAG_ALPHA_TARGET = 0.08;
const DRAG_EXTRA_DAMPING = 0.4;
const MAX_DRAG_DAMPING = 0.9;
/** Repulsion accuracy while dragging. Kept loose enough that a big graph's
 *  Barnes-Hut tick finishes well inside the frame budget — an over-tight theta
 *  overruns 16 ms and the drag stutters. */
const DRAG_THETA = 0.75;
/** The grabbed node tracks the pointer tightly (near 1:1) so dragging feels
 *  responsive; the smoothing/inertia lives in how neighbors follow via links,
 *  not in lagging the node you're holding. */
const DRAG_FOLLOW = 0.65;
/** Links stiffen while dragging so neighbors follow the pointer harder — the
 *  dragged note tows its connections along. Tighter theta keeps the pull from
 *  turning into a whole-graph wobble. */
const DRAG_LINK_BOOST = 2.2;
const MAX_DRAG_LINK_STRENGTH = 1.8;
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
		elasticity: 0.4,
		freeLayout: false,
		collideRadius: 0,
	};
	let running = false;
	let timer: number | null = null;
	// Active drag: the node eases toward this pointer target each tick.
	let dragId: number | null = null;
	const dragTarget = { x: 0, y: 0, z: 0 };
	// Cluster-by-group attraction, persisted across re-inits.
	const cluster = createClusterForce();
	let clusterGroups: Int32Array | null = null;

	// Elastic links are simply stiffer springs; the extra alphaMin keeps a
	// residual jiggle so a stretched graph visibly snaps back.
	const effectiveLinkStrength = () =>
		Math.min(2, params.linkStrength * (1 + params.elasticity * 1.5));

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
			self.clearInterval(timer);
			timer = null;
		}
	};

	const startTimer = (intervalMs: number) => {
		stopTimer();
		running = true;
		timer = self.setInterval(stepOnce, intervalMs);
	};

	const stepOnce = () => {
		if (!simulation || !running) return;
		// Ease the dragged node toward the pointer instead of snapping its fixed
		// position there — the smoothing is what turns jumpy input into a glide.
		if (dragId !== null) {
			const node = nodes[dragId];
			if (node) {
				const cx = node.fx ?? node.x ?? 0;
				const cy = node.fy ?? node.y ?? 0;
				node.fx = cx + (dragTarget.x - cx) * DRAG_FOLLOW;
				node.fy = cy + (dragTarget.y - cy) * DRAG_FOLLOW;
				if (node.fz !== undefined && node.fz !== null) {
					node.fz = node.fz + (dragTarget.z - node.fz) * DRAG_FOLLOW;
				}
			}
		}
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
					.strength(effectiveLinkStrength())
			)
			.force("x", forceX(0).strength(effectiveCentering()))
			.force("y", forceY(0).strength(effectiveCentering()))
			.force("z", dimensions === 3 ? forceZ(0).strength(effectiveCentering()) : null)
			.force("collide", forceCollide(params.collideRadius ?? 0).strength(0.7))
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
							.strength(effectiveLinkStrength());
						simulation.velocityDecay(params.velocityDecay);
						(simulation.force("x") as ReturnType<typeof forceX>).strength(effectiveCentering());
						(simulation.force("y") as ReturnType<typeof forceY>).strength(effectiveCentering());
						const zForce = simulation.force("z") as ReturnType<typeof forceZ> | null;
						if (zForce) zForce.strength(effectiveCentering());
						(simulation.force("collide") as ReturnType<typeof forceCollide>)
							.radius(params.collideRadius ?? 0);
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
				case "drag-start":
					if (simulation) {
						const node = nodes[message.id];
						dragId = message.id;
						dragTarget.x = node?.fx ?? node?.x ?? 0;
						dragTarget.y = node?.fy ?? node?.y ?? 0;
						dragTarget.z = node?.fz ?? node?.z ?? 0;
						if (node) {
							node.fx = dragTarget.x;
							node.fy = dragTarget.y;
						}
						simulation.alphaTarget(DRAG_ALPHA_TARGET);
						if (simulation.alpha() < DRAG_ALPHA_TARGET) simulation.alpha(DRAG_ALPHA_TARGET);
						simulation.velocityDecay(
							Math.min(MAX_DRAG_DAMPING, params.velocityDecay + DRAG_EXTRA_DAMPING)
						);
						(simulation.force("charge") as ReturnType<typeof forceManyBody>).theta(DRAG_THETA);
						(simulation.force("link") as ReturnType<typeof forceLink>).strength(
							Math.min(MAX_DRAG_LINK_STRENGTH, effectiveLinkStrength() * DRAG_LINK_BOOST)
						);
						startTimer(DRAG_INTERVAL_MS);
					}
					break;
				case "drag-move": {
					const node = nodes[message.id];
					if (node) {
						dragId = message.id;
						dragTarget.x = message.x;
						dragTarget.y = message.y;
						if (message.z !== undefined) dragTarget.z = message.z;
					}
					break;
				}
				case "drag-end":
					if (simulation) {
						if (dragId !== null) {
							// Land exactly on the final pointer target, then stop easing.
							const node = nodes[dragId];
							if (node) {
								node.fx = dragTarget.x;
								node.fy = dragTarget.y;
								if (node.fz !== undefined && node.fz !== null) node.fz = dragTarget.z;
							}
							dragId = null;
						}
						simulation.alphaTarget(0);
						simulation.velocityDecay(params.velocityDecay);
						(simulation.force("charge") as ReturnType<typeof forceManyBody>).theta(BARNES_HUT_THETA);
						(simulation.force("link") as ReturnType<typeof forceLink>)
							.strength(effectiveLinkStrength());
						// Elastic layouts rebound after the drag instead of
						// freezing wherever the pointer left them.
						if (params.elasticity > 0) {
							simulation.alpha(Math.max(simulation.alpha(), 0.15 + params.elasticity * 0.35));
							if (!running) startTimer(FRAME_INTERVAL_MS);
						}
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
