export interface LabelBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function overlapsAny(candidate: LabelBox, occupied: readonly LabelBox[]): boolean {
	return occupied.some((box) =>
		candidate.x < box.x + box.width && candidate.x + candidate.width > box.x &&
		candidate.y < box.y + box.height && candidate.y + candidate.height > box.y
	);
}
