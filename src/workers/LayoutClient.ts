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
		const blob = new Blob([layoutWorkerSource], { type: "text/javascript" });
		this.blobUrl = URL.createObjectURL(blob);
		this.worker = new Worker(this.blobUrl);
		this.worker.onmessage = (event: MessageEvent<EngineOutMessage>) => {
			const message = event.data;
			if (message.type === "tick") {
				this.onPositions(message.positions, message.alpha);
			} else if (message.type === "end") {
				this.onSettled(message.positions);
			}
		};
		this.worker.onerror = (event: ErrorEvent) => {
			// An uncaught throw leaves the worker in an undefined state; drop it
			// rather than keep pushing messages into something that stopped
			// ticking, and let the caller surface it.
			const reason = event.message || "layout worker stopped";
			console.error("Advanced Graph View: layout worker failed", event);
			this.stop();
			this.onError?.(reason);
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
		// Seed is deliberately NOT transferred: callers may still hold views
		// onto it; 80 KB copy per rebuild is nothing.
		this.worker.postMessage(message, [edges.buffer, weights.buffer]);
	}

	pin(id: number, x: number, y: number, z?: number): void {
		this.worker?.postMessage({ type: "pin", id, x, y, z } satisfies EngineInMessage);
	}

	unpin(id: number): void {
		this.worker?.postMessage({ type: "unpin", id } satisfies EngineInMessage);
	}

	setParams(params: PhysicsParams): void {
		this.worker?.postMessage({ type: "params", params } satisfies EngineInMessage);
	}

	dragStart(id: number): void {
		this.worker?.postMessage({ type: "drag-start", id } satisfies EngineInMessage);
	}

	/** Smoothed pointer target for the node being dragged. */
	dragMove(id: number, x: number, y: number, z?: number): void {
		this.worker?.postMessage({ type: "drag-move", id, x, y, z } satisfies EngineInMessage);
	}

	dragEnd(): void {
		this.worker?.postMessage({ type: "drag-end" } satisfies EngineInMessage);
	}

	/** Cluster nodes by group id (same tag/folder pull together); null = off. */
	setCluster(groups: Int32Array | null): void {
		this.worker?.postMessage(
			{ type: "cluster", groups } satisfies EngineInMessage,
			groups ? [groups.buffer] : []
		);
	}

	/** alpha 1 = full re-layout, 0.5 = nudge. */
	reheat(alpha?: number): void {
		this.worker?.postMessage({ type: "reheat", alpha } satisfies EngineInMessage);
	}

	stop(): void {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
		if (this.blobUrl) {
			URL.revokeObjectURL(this.blobUrl);
			this.blobUrl = null;
		}
	}
}
