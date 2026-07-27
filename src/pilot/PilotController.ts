/**
 * Flight model for Pilot mode — step 1 of the pilot plan.
 *
 * Held keys become an acceleration, acceleration becomes velocity, velocity
 * moves the camera. Nothing here touches the renderer or the DOM: the whole
 * point of a separate module is that the feel of the controls (how quickly it
 * builds speed, how fast it coasts to a stop, how fast it can ever go) is
 * tunable and checkable without flying the graph by hand.
 *
 * Motion sickness and runaway speed are the risks called out in the plan, so
 * speed is hard-clamped and damping always wins when no key is held.
 */

/** Which way the ship is being pushed this frame, in ship-local axes. */
export interface PilotInput {
	/** +1 forward (W), −1 back (S). */
	forward: number;
	/** +1 right (D), −1 left (A). */
	right: number;
	/** +1 up (Space), −1 down (Shift). */
	up: number;
}

export const NO_INPUT: PilotInput = { forward: 0, right: 0, up: 0 };

export interface PilotTuning {
	/** Acceleration from a standstill at full stick, world units per second².
	 *  Thrust eases off as the ship approaches top speed. */
	acceleration: number;
	/** Top speed, world units per second. Approached, never exceeded. */
	maxSpeed: number;
	/** Share of speed shed per second when coasting (0..1). */
	damping: number;
	/** Below this speed the ship is treated as stopped, so it settles cleanly
	 *  instead of drifting forever on a vanishing remainder. */
	restSpeed: number;
	/** Boost multiplier while the boost key is held. */
	boostFactor: number;
}

export const DEFAULT_TUNING: PilotTuning = {
	acceleration: 2600,
	maxSpeed: 1200,
	damping: 0.88,
	restSpeed: 1,
	boostFactor: 2.5,
};

/** Velocity in ship-local axes: forward / right / up. */
export interface PilotVelocity {
	forward: number;
	right: number;
	up: number;
}

/** Longest frame the integrator will accept, in seconds. A backgrounded tab
 *  resumes with a huge delta; without the cap the ship teleports across the
 *  vault on the first frame back. */
const MAX_STEP_SECONDS = 0.1;

function magnitude(v: PilotVelocity): number {
	return Math.hypot(v.forward, v.right, v.up);
}

/** Scale a direction to unit length; a zero vector stays zero. */
function normalize(input: PilotInput): PilotInput {
	const length = Math.hypot(input.forward, input.right, input.up);
	if (length <= 1e-6) return NO_INPUT;
	// Diagonal input must not be faster than straight input — the classic
	// "strafe-running" bug where W+D outruns W.
	if (length <= 1) return input;
	return {
		forward: input.forward / length,
		right: input.right / length,
		up: input.up / length,
	};
}

export class PilotController {
	velocity: PilotVelocity = { forward: 0, right: 0, up: 0 };

	constructor(readonly tuning: PilotTuning = DEFAULT_TUNING) {}

	/** Current speed, world units per second. */
	get speed(): number {
		return magnitude(this.velocity);
	}

	/** Cut the engines and stop dead — used when leaving pilot mode. */
	reset(): void {
		this.velocity = { forward: 0, right: 0, up: 0 };
	}

	/**
	 * Advance the flight model by `dt` seconds and return the distance to move
	 * along each ship axis this frame.
	 */
	update(dt: number, input: PilotInput = NO_INPUT, boosting = false): PilotVelocity {
		const step = Math.min(Math.max(dt, 0), MAX_STEP_SECONDS);
		if (step === 0) return { forward: 0, right: 0, up: 0 };

		const { acceleration, maxSpeed, damping, restSpeed, boostFactor } = this.tuning;
		const direction = normalize(input);
		const coasting = direction.forward === 0 && direction.right === 0 && direction.up === 0;
		const throttle = boosting ? boostFactor : 1;

		// Both thrust and drag are exponential approaches toward a target
		// speed, differing only in what they aim at and how fast they get
		// there. Thrust aims at top speed, which is why top speed is a limit the
		// ship approaches rather than a clamp bolted on afterwards — clamping
		// after the fact makes the result depend on frame length.
		const topSpeed = maxSpeed * throttle;
		const rate = coasting
			? // `damping` is the share of speed lost per second; as a continuous
				// rate that is −ln(1 − damping).
				-Math.log(Math.max(1 - damping, Number.MIN_VALUE))
			: acceleration / maxSpeed;
		const target = {
			forward: direction.forward * topSpeed,
			right: direction.right * topSpeed,
			up: direction.up * topSpeed,
		};

		const before = this.velocity;
		const next = { forward: 0, right: 0, up: 0 };
		const travelled = { forward: 0, right: 0, up: 0 };

		for (const axis of ["forward", "right", "up"] as const) {
			const v0 = before[axis];
			const v = target[axis];
			if (rate <= 0 || !Number.isFinite(rate)) {
				// No drag and no thrust: the ship simply drifts on.
				next[axis] = v0;
				travelled[axis] = v0 * step;
				continue;
			}
			// Exact solution of dv/dt = rate · (target − v), integrated over the
			// frame for both the new speed and the distance covered. Doing this
			// in closed form is what makes a 30 fps flight land in the same
			// place as a 120 fps one.
			const decay = Math.exp(-rate * step);
			next[axis] = v + (v0 - v) * decay;
			travelled[axis] = v * step + ((v0 - v) * (1 - decay)) / rate;
		}

		if (coasting && Math.hypot(next.forward, next.right, next.up) < restSpeed) {
			next.forward = 0;
			next.right = 0;
			next.up = 0;
		}

		this.velocity = next;
		return travelled;
	}
}
