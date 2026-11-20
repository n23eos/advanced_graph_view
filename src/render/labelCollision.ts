export interface LabelBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

function overlaps(left: LabelBox, right: LabelBox): boolean {
	return left.x < right.x + right.width && left.x + left.width > right.x &&
		left.y < right.y + right.height && left.y + left.height > right.y;
}

/** Legacy linear scan kept for old rendering paths. */
export function overlapsAny(candidate: LabelBox, occupied: readonly LabelBox[]): boolean {
	return occupied.some((box) => overlaps(candidate, box));
}

/**
 * Reusable screen-space collision grid. A label is stored in every cell it
 * touches, while queries inspect only the candidate's cells.
 */
export class LabelCollisionGrid {
	private readonly rows = new Map<number, Map<number, LabelBox[]>>();
	private readonly cellSize: number;
	private count = 0;

	constructor(cellSize = 64) {
		if (!Number.isFinite(cellSize) || cellSize <= 0) {
			throw new RangeError("LabelCollisionGrid cellSize must be positive");
		}
		this.cellSize = cellSize;
	}

	get size(): number {
		return this.count;
	}

	clear(): void {
		this.rows.clear();
		this.count = 0;
	}

	overlaps(candidate: LabelBox): boolean {
		const [minX, maxX, minY, maxY] = this.cellRange(candidate);
		for (let cellY = minY; cellY <= maxY; cellY++) {
			const row = this.rows.get(cellY);
			if (!row) continue;
			for (let cellX = minX; cellX <= maxX; cellX++) {
				const boxes = row.get(cellX);
				if (boxes?.some((box) => overlaps(candidate, box))) return true;
			}
		}
		return false;
	}

	insert(box: LabelBox): void {
		const [minX, maxX, minY, maxY] = this.cellRange(box);
		for (let cellY = minY; cellY <= maxY; cellY++) {
			let row = this.rows.get(cellY);
			if (!row) {
				row = new Map();
				this.rows.set(cellY, row);
			}
			for (let cellX = minX; cellX <= maxX; cellX++) {
				let boxes = row.get(cellX);
				if (!boxes) {
					boxes = [];
					row.set(cellX, boxes);
				}
				boxes.push(box);
			}
		}
		this.count++;
	}

	tryInsert(box: LabelBox): boolean {
		if (this.overlaps(box)) return false;
		this.insert(box);
		return true;
	}

	private cellRange(box: LabelBox): [number, number, number, number] {
		const left = Math.min(box.x, box.x + box.width);
		const right = Math.max(box.x, box.x + box.width);
		const top = Math.min(box.y, box.y + box.height);
		const bottom = Math.max(box.y, box.y + box.height);
		return [
			Math.floor(left / this.cellSize),
			Math.floor(right / this.cellSize),
			Math.floor(top / this.cellSize),
			Math.floor(bottom / this.cellSize),
		];
	}
}
