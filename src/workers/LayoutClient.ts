/**
 * Main-thread handle for the layout worker: spawns it from the inlined
 * source string, forwards protocol messages, surfaces position updates.
 */
import layoutWorkerSource from "worker:./layout.worker";
import type { EngineInMessage, EngineOutMessage, PhysicsParams } from "./layoutEngine";
import type { GraphModel } from "../data/GraphStore";

export class LayoutClient {
	private worker: Worker | null = null;
	private blobUrl: string | null = null;

	constructor(
		private readonly onPositions: (positions: Float32Array, alpha: number) => void,
		private readonly onSettled: (positions: Float32Array) => void,
		/** Called when the worker dies. The graph stays on screen, frozen at the
		 *  last positions it sent — the caller decides whether to offer a retry. */
		private readonly onError?: (reason: string) => void
	) {}

	start(model: GraphModel, seedPositions?: Float32Array, dimensions: 2 | 3 = 2, isStatic = false): void {
		this.stop();
		try {
			const blob = new Blob([layoutWorkerSource], { type: "text/javascript" });
			this.blobUrl = URL.createObjectURL(blob);
			const worker = new Worker(this.blobUrl);
			this.worker = worker;
			worker.onmessage = (event: MessageEvent<EngineOutMessage>) => {
				if (this.worker !== worker) return;
				const message = event.data;
				if (message.type === "tick") {
					this.onPositions(message.positions, message.alpha);
				} else if (message.type === "end") {
					this.onSettled(message.positions);
				}
			};
			worker.onerror = (event: ErrorEvent) => {
				if (this.worker !== worker) return;
				this.fail(event.message || "layout worker stopped", event);
			};

			const edges = new Uint32Array(model.edges.length * 2);
			const weights = new Float32Array(model.edges.length);
			for (let i = 0; i < model.edges.length; i++) {
				edges[i * 2] = model.edges[i].source;
				edges[i * 2 + 1] = model.edges[i].target;
				weights[i] = model.edges[i].weight;
			}

			const message: EngineInMessage = {
				type: "init",
				nodeCount: model.nodes.length,
				edges,
				weights,
				positions: seedPositions,
				dimensions,
				static: isStatic,
			};
			// Seed is deliberately not transferred: callers may still hold views
			// onto it; an 80 KB copy per rebuild is negligible.
			this.post(message, [edges.buffer, weights.buffer]);
		} catch (error) {
			this.fail(errorReason(error, "layout worker failed to start"), error);
		}
	}

	private fail(reason: string, error: unknown): void {
		console.error("Advanced Graph View: layout worker failed", error);
		this.stop();
		this.onError?.(reason);
	}

	private post(message: EngineInMessage, transfer?: Transferable[]): void {
		const worker = this.worker;
		if (!worker) return;
		try {
			if (transfer) worker.postMessage(message, transfer);
			else worker.postMessage(message);
		} catch (error) {
			if (this.worker === worker) {
				this.fail(errorReason(error, "layout worker post failed"), error);
			}
		}
	}

	pin(id: number, x: number, y: number, z?: number): void {
		this.post({ type: "pin", id, x, y, z } satisfies EngineInMessage);
	}

	unpin(id: number): void {
		this.post({ type: "unpin", id } satisfies EngineInMessage);
	}

	setParams(params: PhysicsParams): void {
		this.post({ type: "params", params } satisfies EngineInMessage);
	}

	dragStart(id: number): void {
		this.post({ type: "drag-start", id } satisfies EngineInMessage);
	}

	/** Smoothed pointer target for the node being dragged. */
	dragMove(id: number, x: number, y: number, z?: number): void {
		this.post({ type: "drag-move", id, x, y, z } satisfies EngineInMessage);
	}

	dragEnd(): void {
		this.post({ type: "drag-end" } satisfies EngineInMessage);
	}

	/** Cluster nodes by group id (same tag/folder pull together); null = off. */
	setCluster(groups: Int32Array | null): void {
		this.post(
			{ type: "cluster", groups } satisfies EngineInMessage,
			groups ? [groups.buffer] : []
		);
	}

	/** alpha 1 = full re-layout, 0.5 = nudge. */
	reheat(alpha?: number): void {
		this.post({ type: "reheat", alpha } satisfies EngineInMessage);
	}

	stop(): void {
		const worker = this.worker;
		this.worker = null;
		if (worker) {
			worker.onmessage = null;
			worker.onerror = null;
			worker.terminate();
		}
		if (this.blobUrl) {
			URL.revokeObjectURL(this.blobUrl);
			this.blobUrl = null;
		}
	}
}

function errorReason(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
