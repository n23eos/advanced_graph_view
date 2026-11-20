export const EDGE_PULSE_LIMIT = 36;
export const EDGE_PULSE_TRAVEL_MS = 460;
export const EDGE_PULSE_ARRIVAL_MS = 180;
export const EDGE_PULSE_MAX_STAGGER_MS = 90;
export const EDGE_PULSE_TAIL_FRACTION = 0.2;

export interface EdgePulsePhase {
	visible: boolean;
	done: boolean;
	head: number;
	tail: number;
	arrival: number;
}

export interface PackedPath {
	points: Float32Array;
	offset: number;
	pointCount: number;
	reversed: boolean;
}

/**
 * Select a stable, evenly distributed subset instead of taking only the first
 * links of a hub. This bounds both CPU work and the amount of simultaneous
 * light on screen.
 */
export function selectPulseEdges(
	incident: readonly number[],
	limit = EDGE_PULSE_LIMIT
): number[] {
	const count = Math.max(0, Math.min(incident.length, Math.floor(limit)));
	if (count === incident.length) return incident.slice();
	if (count === 0) return [];
	const selected = new Array<number>(count);
	const stride = incident.length / count;
	for (let i = 0; i < count; i++) {
		selected[i] = incident[Math.min(incident.length - 1, Math.floor((i + 0.5) * stride))];
	}
	return selected;
}

export function pulseDelay(index: number, count: number): number {
	if (count <= 1) return 0;
	return (Math.max(0, index) / (count - 1)) * EDGE_PULSE_MAX_STAGGER_MS;
}

/** One outward trip followed by a brief arrival bloom. */
export function edgePulsePhase(elapsedMs: number, delayMs = 0): EdgePulsePhase {
	const local = elapsedMs - delayMs;
	if (local < 0) return { visible: false, done: false, head: 0, tail: 0, arrival: 0 };
	if (local <= EDGE_PULSE_TRAVEL_MS) {
		const head = Math.max(0, Math.min(1, local / EDGE_PULSE_TRAVEL_MS));
		return {
			visible: true,
			done: false,
			head,
			tail: Math.max(0, head - EDGE_PULSE_TAIL_FRACTION),
			arrival: 0,
		};
	}
	const arrivalProgress = (local - EDGE_PULSE_TRAVEL_MS) / EDGE_PULSE_ARRIVAL_MS;
	if (arrivalProgress <= 1) {
		return {
			visible: true,
			done: false,
			head: 1,
			tail: 1,
			arrival: Math.sin(Math.max(0, arrivalProgress) * Math.PI),
		};
	}
	return { visible: false, done: true, head: 1, tail: 1, arrival: 0 };
}

function pathPoint(path: PackedPath, index: number): { x: number; y: number } {
	const stored = path.reversed ? path.pointCount - 1 - index : index;
	const offset = path.offset + stored * 2;
	return { x: path.points[offset], y: path.points[offset + 1] };
}

/**
 * Slice the packed EdgeMesh centerline by arc length. The result follows the
 * displayed curve rather than interpolating directly between its endpoints.
 */
export function slicePackedPath(
	path: PackedPath,
	from: number,
	to: number,
	out: number[] = []
): number[] {
	out.length = 0;
	if (path.pointCount < 2) return out;
	const start = Math.max(0, Math.min(1, from));
	const end = Math.max(start, Math.min(1, to));
	const lengths = new Array<number>(path.pointCount - 1);
	let total = 0;
	let previous = pathPoint(path, 0);
	for (let i = 1; i < path.pointCount; i++) {
		const current = pathPoint(path, i);
		const length = Math.hypot(current.x - previous.x, current.y - previous.y);
		lengths[i - 1] = length;
		total += length;
		previous = current;
	}
	if (total <= 0) return out;

	const startDistance = start * total;
	const endDistance = end * total;
	let distance = 0;
	for (let i = 0; i < lengths.length; i++) {
		const segmentLength = lengths[i];
		const segmentEnd = distance + segmentLength;
		if (segmentLength > 0 && segmentEnd >= startDistance && distance <= endDistance) {
			const a = pathPoint(path, i);
			const b = pathPoint(path, i + 1);
			const localStart = Math.max(0, (startDistance - distance) / segmentLength);
			const localEnd = Math.min(1, (endDistance - distance) / segmentLength);
			if (out.length === 0) {
				out.push(
					a.x + (b.x - a.x) * localStart,
					a.y + (b.y - a.y) * localStart
				);
			}
			out.push(
				a.x + (b.x - a.x) * localEnd,
				a.y + (b.y - a.y) * localEnd
			);
		}
		distance = segmentEnd;
		if (distance > endDistance) break;
	}
	return out;
}
