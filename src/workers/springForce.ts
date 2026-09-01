/**
 * A real Hooke spring on every edge, as an alternative to d3's `forceLink`.
 *
 * `forceLink` is a positional constraint solver, not a spring: it walks each
 * link and shoves both endpoints straight onto the rest distance, weighted by
 * degree. That converges fast and looks stiff — a stretched edge slides back
 * and stops dead, never sailing past its rest length. Rubber-band feel needs
 * the overshoot, which needs a force proportional to extension plus an
 * explicit damping term the caller can dial down.
 */

/** The subset of a d3 simulation node this force reads and writes. */
export interface SpringNode {
	id: number;
	x?: number;
	y?: number;
	z?: number;
	vx?: number;
	vy?: number;
	vz?: number;
}

export interface SpringLink {
	source: number;
	target: number;
	weight: number;
}

export interface SpringParams {
	/** Force per world unit of extension. */
	stiffness: number;
	/** Edge length the spring pulls toward. */
	restLength: number;
	/** How hard motion along the edge is bled off. 0 = bouncy, ~1 = dead. */
	damping: number;
}

export interface SpringForce {
	(alpha: number): void;
	initialize(nodes: SpringNode[]): void;
	setLinks(links: SpringLink[] | null): void;
	setDegrees(degrees: Int32Array | null): void;
	setParams(params: SpringParams): void;
}

/** Below this separation there is no meaningful direction to push along, and
 *  dividing by it would hand the simulation an Infinity. */
const MIN_DISTANCE = 1e-6;

/** Ceiling on a single tick's impulse, in world units per tick. A stiff spring
 *  on a freshly scattered graph can otherwise fling nodes off to infinity
 *  before damping ever gets a chance to bite. */
const MAX_IMPULSE = 40;

export function createSpringForce(): SpringForce {
	let nodes: SpringNode[] = [];
	let links: SpringLink[] | null = null;
	let degrees: Int32Array | null = null;
	let stiffness = 0;
	let restLength = 40;
	let damping = 0.5;

	/** Share of an edge's impulse a node takes, damped by how many edges it
	 *  already carries. No degree data = full share. */
	const nodeBias = (id: number): number =>
		degrees ? 1 / Math.max(1, degrees[id]) : 1;

	const force = ((alpha: number) => {
		if (!links || stiffness <= 0) return;
		const is3D = nodes.length > 0 && nodes[0].z !== undefined;

		for (const link of links) {
			const a = nodes[link.source];
			const b = nodes[link.target];
			if (!a || !b) continue;

			const dx = (b.x ?? 0) - (a.x ?? 0);
			const dy = (b.y ?? 0) - (a.y ?? 0);
			const dz = is3D ? (b.z ?? 0) - (a.z ?? 0) : 0;
			const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (distance < MIN_DISTANCE) continue;

			// Unit vector from a to b.
			const ux = dx / distance;
			const uy = dy / distance;
			const uz = dz / distance;

			// Hooke: positive when stretched, so both ends pull inward.
			const spring = stiffness * (distance - restLength) * link.weight;

			// Damping opposes how fast the two ends are separating, measured
			// along the edge only — motion across the edge is left alone so the
			// graph can still swing around.
			const relative =
				((b.vx ?? 0) - (a.vx ?? 0)) * ux +
				((b.vy ?? 0) - (a.vy ?? 0)) * uy +
				(is3D ? ((b.vz ?? 0) - (a.vz ?? 0)) * uz : 0);

			const raw = (spring + damping * relative) * alpha;
			const impulse = Math.max(-MAX_IMPULSE, Math.min(MAX_IMPULSE, raw));

			// Each end absorbs the impulse in inverse proportion to its own
			// degree — a hub summing 500 edges would otherwise pick up 500x the
			// force of a leaf and fling itself out of the graph. d3's forceLink
			// carries the same asymmetry for the same reason.
			const biasA = nodeBias(link.source);
			const biasB = nodeBias(link.target);

			a.vx = (a.vx ?? 0) + ux * impulse * biasA;
			a.vy = (a.vy ?? 0) + uy * impulse * biasA;
			b.vx = (b.vx ?? 0) - ux * impulse * biasB;
			b.vy = (b.vy ?? 0) - uy * impulse * biasB;
			if (is3D) {
				a.vz = (a.vz ?? 0) + uz * impulse * biasA;
				b.vz = (b.vz ?? 0) - uz * impulse * biasB;
			}
		}
	}) as SpringForce;

	force.initialize = (n: SpringNode[]) => { nodes = n; };
	force.setLinks = (l: SpringLink[] | null) => { links = l; };
	force.setDegrees = (d: Int32Array | null) => { degrees = d; };
	force.setParams = (p: SpringParams) => {
		stiffness = p.stiffness;
		restLength = p.restLength;
		damping = p.damping;
	};
	return force;
}
