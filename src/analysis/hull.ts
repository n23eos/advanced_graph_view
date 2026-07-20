/** Andrew's monotone chain convex hull — used for cluster bubbles. */

export interface Point {
	x: number;
	y: number;
}

function cross(o: Point, a: Point, b: Point): number {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function convexHull(points: readonly Point[]): Point[] {
	if (points.length < 3) return [...points];

	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

	const lower: Point[] = [];
	for (const point of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
			lower.pop();
		}
		lower.push(point);
	}

	const upper: Point[] = [];
	for (let i = sorted.length - 1; i >= 0; i--) {
		const point = sorted[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
			upper.pop();
		}
		upper.push(point);
	}

	lower.pop();
	upper.pop();
	return [...lower, ...upper];
}
