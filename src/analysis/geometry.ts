/** Ray-casting point-in-polygon — lasso selection hit test. */
import type { Point } from "./hull";

/** Distance from a point to a line segment — semantic edge hit test. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const lengthSq = abx * abx + aby * aby;
	if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
	let t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		const crossesRay = (a.y > point.y) !== (b.y > point.y);
		if (crossesRay) {
			const intersectX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
			if (point.x < intersectX) inside = !inside;
		}
	}
	return inside;
}
