/**
 * Pilot mode input → ship motion (FPS-style). The mouse always steers 1:1
 * (yaw/pitch from raw movement), WASD/Space/C translate the ship with inertia.
 * No banking roll — kept deliberately flat so aiming stays comfortable.
 *
 * The camera it drives is anything with the small ShipCamera surface —
 * Camera3D satisfies it, and tests use a stub.
 */

/** Minimal camera surface the controller needs; Camera3D implements it. */
export interface ShipCamera {
	yaw: number;
	pitch: number;
	fly(distance: number): void;
	strafe(rightUnits: number, upUnits: number): void;
}

/** Per-second axis intents, each clamped to [-1, 1]. */
export interface ShipIntent {
	forward: number;
	strafe: number;
	lift: number;
	boost: boolean;
}

const MAX_SPEED = 150; // world units / second at full throttle (cruise)
const BOOST_FACTOR = 2.4;
const RESPONSE = 5; // velocity smoothing rate (1/s): higher = snappier
const MOUSE_SENS = 0.0024; // radians per pixel of mouse movement
const PITCH_LIMIT = 1.45; // ~83°, keeps the horizon from flipping

/**
 * Exponential approach of `current` speed toward `intent`·`max`, integrated
 * over `dt` seconds. Frame-rate independent: same result whatever the FPS.
 * intent 0 → decays to rest; intent ±1 → approaches ±max; never overshoots.
 */
export function stepSpeed(
	current: number,
	intent: number,
	dt: number,
	max = MAX_SPEED,
	response = RESPONSE
): number {
	const target = clamp(intent, -1, 1) * max;
	const t = 1 - Math.exp(-response * Math.max(0, dt));
	return current + (target - current) * t;
}

/** Keep pitch inside ±limit so the view never tumbles past vertical. */
export function clampPitch(pitch: number, limit = PITCH_LIMIT): number {
	return clamp(pitch, -limit, limit);
}

function clamp(value: number, lo: number, hi: number): number {
	return value < lo ? lo : value > hi ? hi : value;
}

export class PilotController {
	private vForward = 0;
	private vStrafe = 0;
	private vLift = 0;
	private intent: ShipIntent = { forward: 0, strafe: 0, lift: 0, boost: false };
	/** Mouse-look deltas accumulated since the last update (pixels). */
	private pendingYaw = 0;
	private pendingPitch = 0;

	setIntent(intent: ShipIntent): void {
		this.intent = intent;
	}

	/** Feed raw mouse movement (movementX/Y). Steers the view directly. */
	addLook(dxPixels: number, dyPixels: number): void {
		this.pendingYaw += dxPixels;
		this.pendingPitch += dyPixels;
	}

	/** Advance the ship by `dtMs` milliseconds. Returns true if it moved. */
	update(camera: ShipCamera, dtMs: number): boolean {
		const dt = dtMs / 1000;
		const max = this.intent.boost ? MAX_SPEED * BOOST_FACTOR : MAX_SPEED;
		this.vForward = stepSpeed(this.vForward, this.intent.forward, dt, max);
		this.vStrafe = stepSpeed(this.vStrafe, this.intent.strafe, dt, max);
		this.vLift = stepSpeed(this.vLift, this.intent.lift, dt, max);

		const yawDelta = this.pendingYaw * MOUSE_SENS;
		const pitchDelta = this.pendingPitch * MOUSE_SENS;
		this.pendingYaw = 0;
		this.pendingPitch = 0;

		const moving =
			Math.abs(this.vForward) > 0.01 ||
			Math.abs(this.vStrafe) > 0.01 ||
			Math.abs(this.vLift) > 0.01 ||
			yawDelta !== 0 ||
			pitchDelta !== 0;
		if (!moving) return false;

		camera.yaw += yawDelta;
		camera.pitch = clampPitch(camera.pitch - pitchDelta);
		camera.fly(this.vForward * dt);
		camera.strafe(this.vStrafe * dt, this.vLift * dt);
		return true;
	}

	/** Forward speed as a 0..1 fraction of cruise max — for the throttle bar. */
	currentThrottle(): number {
		return Math.min(1, Math.abs(this.vForward) / MAX_SPEED);
	}

	/** Kill all velocity and pending look — used when leaving pilot mode. */
	reset(): void {
		this.vForward = this.vStrafe = this.vLift = 0;
		this.pendingYaw = this.pendingPitch = 0;
		this.intent = { forward: 0, strafe: 0, lift: 0, boost: false };
	}
}
