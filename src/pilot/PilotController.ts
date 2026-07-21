/**
 * Pilot mode input → ship motion. Translates held keys (forward/strafe/lift)
 * and mouse look into camera movement with inertia, so flight feels like a
 * ship coasting rather than teleporting. The camera it drives is anything with
 * the small ShipCamera surface — Camera3D satisfies it, and tests use a stub.
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
	/** Yaw the ship left/right (A/D); the view banks into the turn. */
	turn: number;
	lift: number;
	boost: boolean;
}

const MAX_SPEED = 150; // world units / second at full throttle (cruise)
const BOOST_FACTOR = 2.4;
const RESPONSE = 5; // velocity smoothing rate (1/s): higher = snappier
const MOUSE_SENS = 0.0026; // radians per pixel
const PITCH_LIMIT = 1.45; // ~83°, keeps the horizon from flipping
const TURN_RATE = 1.7; // radians / second of yaw from A/D
/** Bank angle at full turn — the whole view rolls, selling the cockpit. */
const MAX_ROLL = 0.42;
const ROLL_RESPONSE = 6; // how fast the bank eases in/out (1/s)

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
	private vLift = 0;
	/** Current bank angle (radians); eased toward the turn input. */
	private roll = 0;
	private intent: ShipIntent = { forward: 0, turn: 0, lift: 0, boost: false };
	/** Mouse-look deltas accumulated since the last update (pixels). */
	private pendingYaw = 0;
	private pendingPitch = 0;

	setIntent(intent: ShipIntent): void {
		this.intent = intent;
	}

	/** Feed raw mouse movement (e.g. pointer-lock movementX/Y). */
	addLook(dxPixels: number, dyPixels: number): void {
		this.pendingYaw += dxPixels;
		this.pendingPitch += dyPixels;
	}

	/** Advance the ship by `dtMs` milliseconds. Returns true if it moved. */
	update(camera: ShipCamera, dtMs: number): boolean {
		const dt = dtMs / 1000;
		const max = this.intent.boost ? MAX_SPEED * BOOST_FACTOR : MAX_SPEED;
		this.vForward = stepSpeed(this.vForward, this.intent.forward, dt, max);
		this.vLift = stepSpeed(this.vLift, this.intent.lift, dt, max);

		const yawFromKeys = this.intent.turn * TURN_RATE * dt;
		const yawFromMouse = this.pendingYaw * MOUSE_SENS;
		const pitchDelta = this.pendingPitch * MOUSE_SENS;
		this.pendingYaw = 0;
		this.pendingPitch = 0;

		// Bank into the turn; ease back to level when the keys release.
		const rollTarget = -this.intent.turn * MAX_ROLL;
		const prevRoll = this.roll;
		this.roll += (rollTarget - this.roll) * (1 - Math.exp(-ROLL_RESPONSE * dt));

		const moving =
			Math.abs(this.vForward) > 0.01 ||
			Math.abs(this.vLift) > 0.01 ||
			yawFromKeys !== 0 ||
			yawFromMouse !== 0 ||
			pitchDelta !== 0 ||
			Math.abs(this.roll - prevRoll) > 0.0002;
		if (!moving) return false;

		camera.yaw += yawFromKeys + yawFromMouse;
		camera.pitch = clampPitch(camera.pitch - pitchDelta);
		camera.fly(this.vForward * dt);
		camera.strafe(0, this.vLift * dt);
		return true;
	}

	/** Forward speed as a 0..1 fraction of cruise max — for the throttle bar. */
	currentThrottle(): number {
		return Math.min(1, Math.abs(this.vForward) / MAX_SPEED);
	}

	/** Current bank angle (radians) for the renderer to roll the view. */
	currentRoll(): number {
		return this.roll;
	}

	/** Kill all velocity and pending look — used when leaving pilot mode. */
	reset(): void {
		this.vForward = this.vLift = 0;
		this.roll = 0;
		this.pendingYaw = this.pendingPitch = 0;
		this.intent = { forward: 0, turn: 0, lift: 0, boost: false };
	}
}
