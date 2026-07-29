/**
 * Explore mode, wired up: the controller's state machine driving a real camera
 * and a real overlay, one animation frame at a time.
 *
 * The session owns the frame loop and the camera tween; `ExploreController`
 * owns what state the mode is in. Splitting them keeps the timing rules
 * testable and leaves this file with nothing but glue.
 */
import type { Adjacency } from "../analysis/focus";
import type { GraphRenderer } from "../render/GraphRenderer";
import {
	DEFAULT_EXPLORE_DISTANCE,
	flightPosition,
	framingDistance,
	keptDistance,
	viewpointFor,
	type Vec3,
} from "./cameraFlight";
import {
	DEFAULT_EXPLORE_TUNING,
	ExploreController,
	type ExploreTuning,
} from "./ExploreController";

/** A backgrounded tab returns one enormous frame; cap it so the camera does
 *  not teleport when the view comes back. */
const MAX_FRAME_SECONDS = 0.1;

export interface ExploreSessionCallbacks {
	/** The camera landed on a new node — its neighbourhood changed. */
	onFocusChanged(centerId: number, neighbors: readonly number[]): void;
}

interface CameraTween {
	from: Vec3;
	to: Vec3;
	elapsed: number;
}

export class ExploreSession {
	private readonly controller: ExploreController;
	private frame: number | null = null;
	private lastTimestamp: number | null = null;
	private tween: CameraTween | null = null;

	constructor(
		private readonly renderer: GraphRenderer,
		private readonly adjacency: Adjacency,
		startId: number,
		private readonly callbacks: ExploreSessionCallbacks,
		private readonly tuning: ExploreTuning = DEFAULT_EXPLORE_TUNING
	) {
		this.controller = new ExploreController(startId, tuning);
		// Entering is itself a hop: the camera flies to the start node rather
		// than cutting to it, so the mode begins with the same motion it uses
		// from then on. Entry is the one hop that re-frames: the camera is
		// still parked wherever the whole-graph view left it, which is no
		// scale the user picked for looking at a single note.
		this.flyTo(startId, false);
		this.publishFocus();
		this.drawOverlay();
		this.frame = window.requestAnimationFrame(this.step);
	}

	get currentId(): number {
		return this.controller.currentId;
	}

	get trail(): readonly number[] {
		return this.controller.trail;
	}

	/** Neighbours of the node the camera is on — the links it can travel.
	 *  Deduplicated: two notes linking each other twice are still one route,
	 *  and a repeated id would draw the same link on top of itself. */
	get neighbors(): readonly number[] {
		const centerId = this.controller.currentId;
		if (this.neighborsOf !== centerId) {
			this.neighborsCache = [...new Set(this.adjacency[centerId] ?? [])];
			this.neighborsOf = centerId;
		}
		return this.neighborsCache;
	}

	private neighborsOf: number | null = null;
	private neighborsCache: number[] = [];

	aimAt(nodeId: number | null): void {
		this.controller.aimAt(nodeId);
	}

	jump(): void {
		this.controller.jump();
	}

	back(): void {
		this.controller.back();
	}

	stop(): void {
		if (this.frame !== null) window.cancelAnimationFrame(this.frame);
		this.frame = null;
		this.renderer.setExploreOverlay(null);
	}

	private step = (timestamp: number): void => {
		const previous = this.lastTimestamp;
		this.lastTimestamp = timestamp;
		const dt = previous === null ? 0 : Math.min((timestamp - previous) / 1000, MAX_FRAME_SECONDS);

		const change = this.controller.update(dt);
		if (change.departedTo !== null) this.flyTo(change.departedTo, true);
		this.advanceTween(dt);
		if (change.arrivedAt !== null) this.publishFocus();
		this.drawOverlay();

		this.frame = window.requestAnimationFrame(this.step);
	};

	/**
	 * Aim the camera at a node, starting from wherever it stands now.
	 *
	 * A hop keeps the distance it already had, so the picture does not rescale
	 * under a pointer that only asked to move somewhere — and a wheel-zoom
	 * survives the trip. Only entering the mode re-frames.
	 */
	private flyTo(nodeId: number, keepScale: boolean): void {
		const target = this.renderer.nodePosition(nodeId);
		if (!target) return;
		const from = this.renderer.cameraPosition;
		const distance = keepScale
			? keptDistance(from, this.renderer.nodePosition(this.controller.currentId))
			: this.framedDistance(nodeId);
		this.tween = {
			from,
			to: viewpointFor(target, this.renderer.camera.forward(), distance),
			elapsed: 0,
		};
	}

	/** Standing room that fits a node's own links on screen. */
	private framedDistance(nodeId: number): number {
		const center = this.renderer.nodePosition(nodeId);
		if (!center) return DEFAULT_EXPLORE_DISTANCE;

		let spread = 0;
		for (const id of new Set(this.adjacency[nodeId] ?? [])) {
			const neighbor = this.renderer.nodePosition(id);
			if (!neighbor) continue;
			const distance = Math.hypot(
				neighbor.x - center.x,
				neighbor.y - center.y,
				neighbor.z - center.z
			);
			if (distance > spread) spread = distance;
		}

		return framingDistance(spread);
	}

	private advanceTween(dt: number): void {
		const tween = this.tween;
		if (!tween) return;

		tween.elapsed += dt;
		const progress = Math.min(1, tween.elapsed / this.tuning.flightSeconds);
		const position = flightPosition(tween.from, tween.to, progress);
		// The pivot is the node being travelled to, so orbiting after landing
		// spins the graph around it rather than around the session's start.
		const pivot = this.renderer.nodePosition(
			this.controller.destinationId ?? this.controller.currentId
		);
		this.renderer.placeCamera(position, pivot ?? position);
		if (progress >= 1) this.tween = null;
	}

	private drawOverlay(): void {
		this.renderer.setExploreOverlay({
			centerId: this.controller.currentId,
			neighbors: this.neighbors,
			candidateId: this.controller.candidateId,
		});
	}

	private publishFocus(): void {
		this.callbacks.onFocusChanged(this.controller.currentId, this.neighbors);
	}
}
