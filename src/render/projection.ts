/**
 * Pseudo-3D camera: yaw/pitch rotation + perspective projection onto the
 * 2D Pixi canvas. The whole 2D pipeline (sprites, edge mesh, culling,
 * hit-tests) consumes projected coordinates and never knows about z.
 */

const DEFAULT_FOCAL = 900;
/** Near plane: nodes closer than this vanish (they "fly past" the camera).
 *  Growth is NOT capped before that — swelling into the screen and then
 *  dissolving is what makes motion read as flying through, not sticking. */
const NEAR_PLANE = 40;

export class Camera3D {
	enabled = true;
	yaw = 0;
	pitch = 0;
	focal = DEFAULT_FOCAL;
	/** Camera position in world space. */
	px = 0;
	py = 0;
	pz = 0;
	/** Orbit pivot — the graph center the camera rotates around. */
	tx = 0;
	ty = 0;
	tz = 0;

	/**
	 * Project xyz (stride 3) into out2d (stride 2) + per-point depth scale.
	 * depthScale > 1 = closer than the projection plane, < 1 = farther.
	 */
	project(
		xyz: Float32Array,
		out2d: Float32Array,
		depthScale: Float32Array,
		zOverride?: Float32Array | null
	): void {
		const count = depthScale.length;
		if (!this.enabled) {
			for (let i = 0; i < count; i++) {
				out2d[i * 2] = xyz[i * 3];
				out2d[i * 2 + 1] = xyz[i * 3 + 1];
				depthScale[i] = 1;
			}
			return;
		}

		const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
		const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
		const f = this.focal;

		for (let i = 0; i < count; i++) {
			const x = xyz[i * 3] - this.px;
			const y = xyz[i * 3 + 1] - this.py;
			const z = (zOverride ? zOverride[i] : xyz[i * 3 + 2]) - this.pz;
			// Yaw around Y axis, then pitch around X axis — around the CAMERA.
			const x1 = x * cy + z * sy;
			const z1 = -x * sy + z * cy;
			const y2 = y * cp - z1 * sp;
			const z2 = y * sp + z1 * cp;

			if (f + z2 < NEAR_PLANE) {
				// Node flew past the camera — hide it instead of mirroring.
				out2d[i * 2] = 0;
				out2d[i * 2 + 1] = 0;
				depthScale[i] = 0;
				continue;
			}
			const scale = f / (f + z2);
			out2d[i * 2] = x1 * scale;
			out2d[i * 2 + 1] = y2 * scale;
			depthScale[i] = scale;
		}
	}

	/** Orbit the camera around the scene center (target) at its current
	 *  distance, so the whole scene spins around the center instead of the
	 *  camera turning in place. */
	orbit(deltaYaw: number, deltaPitch: number): void {
		const dx = this.px - this.tx;
		const dy = this.py - this.ty;
		const dz = this.pz - this.tz;
		const radius = Math.hypot(dx, dy, dz) || this.focal;
		this.yaw += deltaYaw;
		this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + deltaPitch));
		const [fx, fy, fz] = this.forward();
		this.px = this.tx - fx * radius;
		this.py = this.ty - fy * radius;
		this.pz = this.tz - fz * radius;
	}

	/** World-space unit vector of the look direction (view +z axis). */
	forward(): [number, number, number] {
		const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
		const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
		return [-cp * sy, sp, cp * cy];
	}

	/** Sideways/vertical camera move in the view plane (world units). Carries
	 *  the orbit pivot along: a pan means "look over there", so the next orbit
	 *  must spin around the panned-to spot, not snap back to the old center. */
	strafe(rightUnits: number, upUnits: number): void {
		const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
		const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
		// View right and up axes expressed in world space (transposed rotation).
		const dx = cy * rightUnits + sp * sy * upUnits;
		const dy = cp * upUnits;
		const dz = sy * rightUnits - sp * cy * upUnits;
		this.px += dx;
		this.py += dy;
		this.pz += dz;
		this.tx += dx;
		this.ty += dy;
		this.tz += dz;
	}

	/** Fly along the look direction; positive = forward into the cloud. */
	fly(distance: number): void {
		const [fx, fy, fz] = this.forward();
		this.px += fx * distance;
		this.py += fy * distance;
		this.pz += fz * distance;
	}

	/**
	 * Convert a screen-plane movement into world-space xyz delta at the
	 * given depth (rotation transposed = inverse; perspective undone).
	 */
	unprojectDelta(screenDx: number, screenDy: number, depthScale: number): [number, number, number] {
		if (!this.enabled) return [screenDx, screenDy, 0];
		const dx = screenDx / depthScale;
		const dy = screenDy / depthScale;
		const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
		const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
		// Inverse pitch (transpose): (dx, dy, 0) → (dx, dy·cp, −dy·sp)
		const y1 = dy * cp;
		const z1 = -dy * sp;
		// Inverse yaw.
		return [dx * cy - z1 * sy, y1, dx * sy + z1 * cy];
	}
}
