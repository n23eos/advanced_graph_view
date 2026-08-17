/**
 * Main-thread handle for the F-10 diff. Small graphs are diffed inline —
 * spawning a worker for them costs more than the diff; §9 sends anything
 * above 10 000 nodes off the UI thread.
 */
import changesWorkerSource from "worker:./changes.worker";
import { liteModel, type ChangesRequest, type ChangesResponse } from "./changes.worker";
import { computeTopologyDiff, type TopologyDiff } from "../analysis/graphChanges";
import type { GraphSnapshot } from "../data/graphSnapshots";
import type { GraphModel } from "../data/GraphStore";

export const CHANGES_WORKER_NODE_THRESHOLD = 10_000;

export class ChangesClient {
	private worker: Worker | null = null;
	private blobUrl: string | null = null;
	private pending: { resolve(diff: TopologyDiff): void; reject(error: Error): void } | null = null;

	/** One diff at a time; a new request while one is in flight rejects. */
	compute(snapshot: GraphSnapshot, model: GraphModel, pagerank: Float32Array | null): Promise<TopologyDiff> {
		const paths = model.nodes.map((node) => node.path);
		if (paths.length <= CHANGES_WORKER_NODE_THRESHOLD) {
			return Promise.resolve(computeTopologyDiff(snapshot, model, pagerank));
		}
		if (this.pending) return Promise.reject(new Error("diff already running"));
		const request: ChangesRequest = {
			type: "diff",
			snapshot,
			paths,
			inCounts: model.nodes.map((node) => node.inCount),
			edges: model.edges.map((edge) => [edge.source, edge.target]),
			pagerank: pagerank ? Array.from(pagerank) : null,
		};
		return new Promise((resolve, reject) => {
			this.pending = { resolve, reject };
			try {
				this.ensureWorker().postMessage(request);
			} catch (error) {
				this.pending = null;
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		const blob = new Blob([changesWorkerSource], { type: "text/javascript" });
		this.blobUrl = URL.createObjectURL(blob);
		this.worker = new Worker(this.blobUrl);
		this.worker.onmessage = (event: MessageEvent<ChangesResponse>) => {
			if (event.data.type !== "result") return;
			const pending = this.pending;
			this.pending = null;
			pending?.resolve(event.data.diff);
		};
		this.worker.onerror = () => {
			// Degrade instead of hanging: fall back to an empty diff.
			const pending = this.pending;
			this.pending = null;
			this.stop();
			pending?.resolve({ addedLinks: [], removedLinks: [], growingHubs: [] });
		};
		return this.worker;
	}

	/** A promise still in flight settles (rejects) — it must never hang. */
	stop(): void {
		this.worker?.terminate();
		this.worker = null;
		if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
		this.blobUrl = null;
		const pending = this.pending;
		this.pending = null;
		pending?.reject(new Error("changes client stopped"));
	}
}

export { liteModel };
