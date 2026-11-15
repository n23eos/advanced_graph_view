/**
 * Tow: how a dragged node carries its neighbourhood, and how that
 * neighbourhood comes to rest once the node is dropped.
 *
 * The feel aimed for is bodies floating in water: heavy, slow to start, slow
 * to stop, never snapping and never bouncing. The simulation's own link
 * forces cannot produce that. They are scaled by alpha and by the user's
 * sliders, they advance once per physics tick (15 Hz on a large 3D vault),
 * and they stop dead the moment the layout cools.
 *
 * So the towed nodes are taken out of the simulation's hands for as long as
 * the gesture lasts and are moved by this module alone:
 *
 * - On grab, a breadth-first walk claims everything within TOW_MAX_DEPTH
 *   links and remembers where each node sat.
 * - Every claimed node chases a target: its own home, shifted by a share of
 *   how far its parent in the walk has actually travelled. Direct neighbours
 *   take almost the whole shift, the next ring less, the third least — the
 *   pull fades into the undisturbed graph instead of hauling all of it.
 * - The chase is a critically damped follower integrated against the wall
 *   clock: velocity is continuous, there is no overshoot, and the motion is
 *   identical at any tick rate or slider setting. Because each node follows
 *   where its parent *is* rather than where it is going, the rings trail one
 *   another like a chain drawn through water.
 * - On release the grabbed node stays where it was dropped and the
 *   neighbourhood keeps drifting until it has gathered around it, a few
 *   seconds later.
 *
 * The nodes are then handed back to the simulation at rest, and the engine
 * stops the layout there: where they were seen to arrive is where they stay.
 */

/** The subset of a d3 simulation node this module reads and writes. */
export interface TowNode {
	id: number;
	x?: number;
	y?: number;
	z?: number;
	vx?: number;
	vy?: number;
	vz?: number;
	fx?: number | null;
	fy?: number | null;
	fz?: number | null;
}

export interface TowForce {
	/** One step. Registered as a d3 force, and also callable on its own when a
	 *  full physics tick is too slow to animate with. Alpha is ignored. */
	(alpha?: number): void;
	initialize(nodes: TowNode[]): void;
	/** Flat [source0, target0, ...] pairs; drops any tow in progress. */
	setEdges(nodeCount: number, edges: Uint32Array): void;
	/** Start towing the neighbourhood of `id`. */
	grab(id: number): void;
	/** Let go. The neighbourhood keeps drifting until it has gathered around
	 *  the dropped node, then is handed back. */
	release(): void;
	/** True from grab until the last towed node has been handed back. */
	active(): boolean;
	/** Ids currently claimed, nearest ring first (for tests and debugging). */
	towed(): readonly number[];
}

/** How many links out from the grabbed node the tow reaches. */
export const TOW_MAX_DEPTH = 3;
/** Share of its parent's travel a node takes on, by ring (index 0 unused).
 *  Compounded: about 92% / 60% / 33% of the pointer's travel. */
export const TOW_FOLLOW = [0, 0.92, 0.65, 0.55];
/** Chase rate (1/s) while the node is held. A critically damped follower
 *  closes 98% of a gap in about 5.8 / rate seconds. */
export const TOW_RATE_HELD = 2.6;
/** Chase rate after release: slower, so the last stretch is a
 *  long, lazy drift — about three and a half seconds for the first ring, a
 *  little longer for each ring behind it. */
export const TOW_RATE_SETTLE = 1.6;
/** Seconds over which the chase rate eases from held to settle on release,
 *  so letting go is not itself felt as a change of pace. */
const RATE_BLEND_SECONDS = 0.6;
/** Extra inertia per link past LIGHT_LINKS: a hub follows less than a leaf,
 *  while an ordinary note with a handful of links is not held back at all. */
const MASS_PER_LINK = 0.06;
const LIGHT_LINKS = 4;
const MAX_MASS = 3;
/** Upper bound on the towed set. */
const MAX_TOWED = 2000;
/** A released tow ends once every node is this close to its target (world
 *  units) and this slow (world units per second)... */
const REST_DISTANCE = 0.15;
const REST_SPEED = 0.6;
/** ...or after this long regardless, so nothing can stay claimed for ever. */
const MAX_RELEASE_SECONDS = 9;
/** Longest step integrated at once. A stalled worker resumes the motion
 *  where it left off instead of jumping to where it would have been. */
const MAX_STEP_SECONDS = 0.05;

const wallClock = (): number =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

type Phase = "idle" | "held" | "settling";

/** @param clock Milliseconds, monotonic. Injected so tests can drive time. */
export function createTowForce(clock: () => number = wallClock): TowForce {
	let nodes: TowNode[] = [];
	// Undirected adjacency in CSR form: neighbours of i are
	// adjacency[offsets[i] .. offsets[i + 1]).
	let offsets = new Uint32Array(1);
	let adjacency = new Uint32Array(0);

	let phase: Phase = "idle";
	let grabbed = -1;
	/** Where the grabbed node sat on grab, and how far it has been carried. */
	let grabbedHome: [number, number, number] = [0, 0, 0];
	let carried: [number, number, number] = [0, 0, 0];
	let steppedAt = 0;
	let releasedAt = 0;

	// Towed set in walk order, so a parent is always stepped before its children.
	let order: number[] = [];
	/** Index into `order` of the node's parent, or -1 for the grabbed node. */
	let parent: number[] = [];
	let follow: number[] = [];
	let home: number[] = []; // xyz
	let position: number[] = []; // xyz, the follower's own state
	let velocity: number[] = []; // xyz, world units per second

	const reset = () => {
		phase = "idle";
		grabbed = -1;
		order = [];
		parent = [];
		follow = [];
		home = [];
		position = [];
		velocity = [];
	};

	/** Hand every towed node back to the simulation, at rest where it is. */
	const handBack = () => {
		for (const id of order) {
			const node = nodes[id];
			if (!node) continue;
			node.vx = 0;
			node.vy = 0;
			if (node.z !== undefined) node.vz = 0;
			node.fx = null;
			node.fy = null;
			node.fz = null;
		}
		reset();
	};

	const chaseRate = (now: number): number => {
		if (phase === "held") return TOW_RATE_HELD;
		const blend = Math.min(1, (now - releasedAt) / 1000 / RATE_BLEND_SECONDS);
		return TOW_RATE_HELD + (TOW_RATE_SETTLE - TOW_RATE_HELD) * blend;
	};

	const apply = (): void => {
		if (phase === "idle") return;
		const now = clock();
		const dt = Math.min(MAX_STEP_SECONDS, Math.max(0, (now - steppedAt) / 1000));
		steppedAt = now;

		if (phase === "held") {
			const lead = nodes[grabbed];
			if (lead) {
				carried = [
					(lead.fx ?? lead.x ?? 0) - grabbedHome[0],
					(lead.fy ?? lead.y ?? 0) - grabbedHome[1],
					lead.z !== undefined ? (lead.fz ?? lead.z) - grabbedHome[2] : 0,
				];
			}
		}

		const rate = chaseRate(now);
		const decay = Math.exp(-rate * dt);
		let resting = true;

		for (let k = 0; k < order.length; k++) {
			const node = nodes[order[k]];
			if (!node) continue;
			const is3D = node.z !== undefined;
			const p = parent[k];

			for (let axis = 0; axis < 3; axis++) {
				if (axis === 2 && !is3D) continue;
				const i = k * 3 + axis;
				const target = home[i] +
					follow[k] * (p < 0 ? carried[axis] : position[p * 3 + axis] - home[p * 3 + axis]);
				// Exact step of a critically damped follower over dt: stable at
				// any step size, continuous in velocity, and it cannot overshoot.
				const gap = position[i] - target;
				const drive = (velocity[i] + rate * gap) * dt;
				position[i] = target + (gap + drive) * decay;
				velocity[i] = (velocity[i] - rate * drive) * decay;
				if (Math.abs(position[i] - target) > REST_DISTANCE || Math.abs(velocity[i]) > REST_SPEED) {
					resting = false;
				}
			}

			// Pinning through fx keeps the simulation's own forces off a node in
			// flight; x is written too because a standalone step has no
			// simulation to copy it over.
			node.x = node.fx = position[k * 3];
			node.y = node.fy = position[k * 3 + 1];
			if (is3D) node.z = node.fz = position[k * 3 + 2];
		}

		if (phase !== "held" && (resting || (now - releasedAt) / 1000 > MAX_RELEASE_SECONDS)) {
			handBack();
		}
	};

	const setEdges = (nodeCount: number, edges: Uint32Array): void => {
		// The node array is about to be replaced; nothing to hand back to.
		reset();
		const edgeCount = edges.length >> 1;
		offsets = new Uint32Array(nodeCount + 1);
		for (let e = 0; e < edgeCount; e++) {
			const s = edges[e * 2];
			const t = edges[e * 2 + 1];
			if (s >= nodeCount || t >= nodeCount || s === t) continue;
			offsets[s + 1]++;
			offsets[t + 1]++;
		}
		for (let i = 0; i < nodeCount; i++) offsets[i + 1] += offsets[i];
		adjacency = new Uint32Array(offsets[nodeCount]);
		const cursor = offsets.slice(0, nodeCount);
		for (let e = 0; e < edgeCount; e++) {
			const s = edges[e * 2];
			const t = edges[e * 2 + 1];
			if (s >= nodeCount || t >= nodeCount || s === t) continue;
			adjacency[cursor[s]++] = t;
			adjacency[cursor[t]++] = s;
		}
	};

	const grab = (id: number): void => {
		// A tow still drifting from the last drop ends here, at rest.
		if (phase !== "idle") handBack();
		const nodeCount = offsets.length - 1;
		const lead = nodes[id];
		if (id < 0 || id >= nodeCount || !lead) return;

		phase = "held";
		grabbed = id;
		grabbedHome = [lead.x ?? 0, lead.y ?? 0, lead.z ?? 0];
		carried = [0, 0, 0];
		steppedAt = clock();

		const seen = new Uint8Array(nodeCount);
		seen[id] = 1;
		// Frontier entries: [node id, index in `order` or -1 for the grabbed node].
		let frontier: Array<[number, number]> = [[id, -1]];
		for (let ring = 1; ring <= TOW_MAX_DEPTH && frontier.length > 0; ring++) {
			const next: Array<[number, number]> = [];
			for (const [from, fromIndex] of frontier) {
				for (let a = offsets[from]; a < offsets[from + 1]; a++) {
					const to = adjacency[a];
					if (seen[to] === 1) continue;
					seen[to] = 1;
					const node = nodes[to];
					// A node the user pinned stays put, and so does whatever
					// hangs off it: the tow does not reach through a pin.
					if (!node || node.fx != null || node.fy != null) continue;
					if (order.length >= MAX_TOWED) break;

					const links = offsets[to + 1] - offsets[to];
					const mass = Math.min(MAX_MASS, 1 + MASS_PER_LINK * Math.max(0, links - LIGHT_LINKS));
					next.push([to, order.length]);
					order.push(to);
					parent.push(fromIndex);
					follow.push(TOW_FOLLOW[ring] / mass);
					const x = node.x ?? 0;
					const y = node.y ?? 0;
					const z = node.z ?? 0;
					home.push(x, y, z);
					position.push(x, y, z);
					velocity.push(0, 0, 0);
				}
			}
			frontier = next;
		}
	};

	const release = (): void => {
		if (phase !== "held") return;
		if (order.length === 0) {
			reset();
			return;
		}
		releasedAt = steppedAt = clock();
		phase = "settling";
	};

	return Object.assign(apply, {
		initialize: (n: TowNode[]) => { nodes = n; },
		setEdges,
		grab,
		release,
		active: () => phase !== "idle",
		towed: () => order,
	});
}
