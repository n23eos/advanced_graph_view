/**
 * The state machine behind explore mode: aim at a link, click, fly there.
 *
 * Nothing here touches the renderer, the camera or the DOM — it owns the
 * flight clock and the trail of visited nodes. Keeping it separate is what
 * makes the rules of the mode (what a click does mid-flight, where back goes)
 * checkable without flying the graph by hand.
 */

export type ExplorePhase = "aiming" | "flying";

export interface ExploreTuning {
	/** How long the camera takes to reach the next node. */
	flightSeconds: number;
}

export const DEFAULT_EXPLORE_TUNING: ExploreTuning = {
	flightSeconds: 0.6,
};

/** What changed during one `update`. Both fields are null on a quiet frame. */
export interface ExploreStep {
	/** Set on the frame a flight begins — the node being flown to. */
	departedTo: number | null;
	/** Set on the frame a flight ends — the node now under the camera. */
	arrivedAt: number | null;
}

const QUIET_STEP: ExploreStep = { departedTo: null, arrivedAt: null };

export class ExploreController {
	private phaseValue: ExplorePhase = "aiming";
	private currentIdValue: number;
	private candidate: number | null = null;
	private flight = 0;
	private destination: number | null = null;
	/** A back-flight rewinds the trail on arrival instead of extending it. */
	private isRewinding = false;
	private jumpRequested = false;
	private backRequested = false;
	/** F-11: a breadcrumb/back target — any node, not just an aimed link. */
	private goRequest: number | null = null;
	private visited: number[];

	constructor(
		startId: number,
		private readonly tuning: ExploreTuning = DEFAULT_EXPLORE_TUNING
	) {
		this.currentIdValue = startId;
		this.visited = [startId];
	}

	get phase(): ExplorePhase {
		return this.phaseValue;
	}

	/** Node the camera is sitting on (unchanged until a flight lands). */
	get currentId(): number {
		return this.currentIdValue;
	}

	/** Link the pointer is aiming down, or null. */
	get candidateId(): number | null {
		return this.candidate;
	}

	/** Node being flown to, or null when not flying. */
	get destinationId(): number | null {
		return this.destination;
	}

	/** Flight interpolation, 0..1; 0 when not flying. */
	get flightProgress(): number {
		return this.flight;
	}

	/** Visited nodes, oldest first, including the current one. */
	get trail(): readonly number[] {
		return this.visited;
	}

	get canGoBack(): boolean {
		return this.visited.length > 1;
	}

	/**
	 * Where the pointer is aiming this frame; null = at no link.
	 *
	 * Aiming alone never moves the camera — it only lights the link up. The
	 * trip is always a deliberate click, so sweeping the pointer across a hub
	 * to read where its links go cannot fling you somewhere by accident.
	 */
	aimAt(nodeId: number | null): void {
		if (this.phaseValue === "flying") return;
		// Aiming at the node the camera already sits on means nothing — there
		// is no link to travel — so it counts as aiming at nothing.
		this.candidate = nodeId === this.currentIdValue ? null : nodeId;
	}

	/** Travel down the aimed link (a click on it). */
	jump(): void {
		this.jumpRequested = true;
	}

	/** Fly back to the previous node on the trail. */
	back(): void {
		this.backRequested = true;
	}

	/** F-11: fly straight to a trail node picked in the breadcrumb. The
	 *  NavigationTrail owns where this lands in the history. */
	goTo(nodeId: number): void {
		this.goRequest = nodeId;
	}

	/** Advance the flight clock by `dt` seconds and report what changed. */
	update(dt: number): ExploreStep {
		if (this.phaseValue === "flying") return this.advanceFlight(dt);

		if (this.goRequest !== null) {
			const target = this.goRequest;
			this.goRequest = null;
			this.backRequested = false;
			this.jumpRequested = false;
			// A plain forward departure: the arrival appends to `visited`, so
			// the invariant "currentId is the last visited node" always holds.
			// The breadcrumb's own history lives in NavigationTrail.
			if (target !== this.currentIdValue) return this.depart(target, false);
			return QUIET_STEP;
		}

		if (this.backRequested) {
			this.backRequested = false;
			this.jumpRequested = false;
			if (this.canGoBack) {
				return this.depart(this.visited[this.visited.length - 2], true);
			}
		}

		if (this.jumpRequested) {
			this.jumpRequested = false;
			if (this.candidate !== null) return this.depart(this.candidate, false);
		}

		return QUIET_STEP;
	}

	private depart(nodeId: number, rewinding: boolean): ExploreStep {
		this.phaseValue = "flying";
		this.destination = nodeId;
		this.isRewinding = rewinding;
		this.flight = 0;
		this.candidate = null;
		return { departedTo: nodeId, arrivedAt: null };
	}

	private advanceFlight(dt: number): ExploreStep {
		// Nothing asked for during a flight can redirect it — a camera that
		// changed its mind halfway would read as a glitch, not as steering.
		this.jumpRequested = false;
		this.backRequested = false;

		this.flight = Math.min(1, this.flight + dt / this.tuning.flightSeconds);
		if (this.flight < 1) return QUIET_STEP;

		const arrivedAt = this.destination as number;
		this.currentIdValue = arrivedAt;
		if (this.isRewinding) {
			this.visited.pop();
		} else {
			this.visited.push(arrivedAt);
		}
		this.phaseValue = "aiming";
		this.destination = null;
		this.flight = 0;
		return { departedTo: null, arrivedAt };
	}
}
