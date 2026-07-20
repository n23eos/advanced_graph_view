import type { Container } from "pixi.js";

const MIN_SCALE = 0.02;
const MAX_SCALE = 8;
const WHEEL_ZOOM_SPEED = 0.0015;

/**
 * Pan/zoom controller: applies transforms to the world container from
 * pointer events on the canvas. Zoom is anchored at the cursor.
 */
export class Viewport {
	private isPanning = false;
	private lastX = 0;
	private lastY = 0;
	/** Set while a node drag is in progress so panning does not kick in. */
	suppressPan = false;

	constructor(
		private readonly world: Container,
		private readonly canvas: HTMLCanvasElement,
		private readonly onChanged: () => void
	) {
		canvas.addEventListener("wheel", this.handleWheel, { passive: false });
		canvas.addEventListener("pointerdown", this.handlePointerDown);
		window.addEventListener("pointermove", this.handlePointerMove);
		window.addEventListener("pointerup", this.handlePointerUp);
	}

	get scale(): number {
		return this.world.scale.x;
	}

	/** Convert canvas-local pixel coordinates to world coordinates. */
	toWorld(canvasX: number, canvasY: number): { x: number; y: number } {
		return {
			x: (canvasX - this.world.position.x) / this.world.scale.x,
			y: (canvasY - this.world.position.y) / this.world.scale.y,
		};
	}

	centerOn(worldX: number, worldY: number, viewWidth: number, viewHeight: number): void {
		this.world.position.set(
			viewWidth / 2 - worldX * this.world.scale.x,
			viewHeight / 2 - worldY * this.world.scale.y
		);
		this.onChanged();
	}

	/** Zoom and pan so the world-space rectangle fills ~80% of the view. */
	fitBounds(
		minX: number, minY: number, maxX: number, maxY: number,
		viewWidth: number, viewHeight: number
	): void {
		const width = Math.max(maxX - minX, 1);
		const height = Math.max(maxY - minY, 1);
		const scale = Math.min(
			MAX_SCALE,
			Math.max(MIN_SCALE, Math.min(viewWidth / width, viewHeight / height) * 0.8)
		);
		this.world.scale.set(scale);
		this.centerOn((minX + maxX) / 2, (minY + maxY) / 2, viewWidth, viewHeight);
	}

	private handleWheel = (event: WheelEvent): void => {
		event.preventDefault();
		const rect = this.canvas.getBoundingClientRect();
		const cx = event.clientX - rect.left;
		const cy = event.clientY - rect.top;
		const before = this.toWorld(cx, cy);

		const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED);
		const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.world.scale.x * factor));
		this.world.scale.set(next);

		// Keep the world point under the cursor fixed while zooming.
		this.world.position.set(cx - before.x * next, cy - before.y * next);
		this.onChanged();
	};

	private handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || this.suppressPan) return;
		this.isPanning = true;
		this.lastX = event.clientX;
		this.lastY = event.clientY;
	};

	private handlePointerMove = (event: PointerEvent): void => {
		if (!this.isPanning || this.suppressPan) return;
		this.world.position.x += event.clientX - this.lastX;
		this.world.position.y += event.clientY - this.lastY;
		this.lastX = event.clientX;
		this.lastY = event.clientY;
		this.onChanged();
	};

	private handlePointerUp = (): void => {
		this.isPanning = false;
	};

	destroy(): void {
		this.canvas.removeEventListener("wheel", this.handleWheel);
		this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
		window.removeEventListener("pointermove", this.handlePointerMove);
		window.removeEventListener("pointerup", this.handlePointerUp);
	}
}
