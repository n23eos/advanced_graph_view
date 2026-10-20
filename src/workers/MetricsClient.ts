/**
 * Main-thread handle for the metrics worker. One in-flight computation at
 * a time; the latest request wins if the model changed mid-flight.
 */
import metricsWorkerSource from "worker:./metrics.worker";
import type { MetricsResponse } from "./metrics.worker";
import type { GraphModel } from "../data/GraphStore";

export interface GraphMetrics {
	pagerank: Float32Array;
	community: Int32Array;
	communityCount: number;
}

export class MetricsClient {
	private worker: Worker | null = null;
	private blobUrl: string | null = null;
	private computing = false;
	private pendingModel: GraphModel | null = null;

	constructor(
		private readonly onResult: (metrics: GraphMetrics) => void,
		/** Called when the worker dies. PageRank and clusters keep their last
		 *  values; everything else in the graph goes on working. */
		private readonly onError?: (reason: string) => void
	) {}

	compute(model: GraphModel): void {
		if (this.computing) {
			this.pendingModel = model;
			return;
		}
		this.computing = true;
		try {
			this.ensureWorker().postMessage(buildRequest(model));
		} catch (error) {
			this.fail(errorReason(error, "metrics worker failed to start"), error);
		}
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		const blob = new Blob([metricsWorkerSource], { type: "text/javascript" });
		this.blobUrl = URL.createObjectURL(blob);
		const worker = new Worker(this.blobUrl);
		this.worker = worker;
		worker.onmessage = (event: MessageEvent<MetricsResponse>) => {
			if (this.worker !== worker) return;
			this.computing = false;
			if (this.pendingModel) {
				const next = this.pendingModel;
				this.pendingModel = null;
				this.compute(next);
				return;
			}
			const { pagerank, community, communityCount } = event.data;
			this.onResult({ pagerank, community, communityCount });
		};
		worker.onerror = (event: ErrorEvent) => {
			if (this.worker !== worker) return;
			// `stop()` clears the computing flag as well — without it a crashed
			// worker would leave every later compute() queued behind a request
			// that can never finish.
			this.fail(event.message || "metrics worker stopped", event);
		};
		return worker;
	}

	private fail(reason: string, error: unknown): void {
		console.error("Advanced Graph View: metrics worker failed", error);
		this.stop();
		this.onError?.(reason);
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
		this.computing = false;
		this.pendingModel = null;
	}
}

function errorReason(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function buildRequest(model: GraphModel) {
	const edges = new Uint32Array(model.edges.length * 2);
	const weights = new Float32Array(model.edges.length);
	for (let i = 0; i < model.edges.length; i++) {
		edges[i * 2] = model.edges[i].source;
		edges[i * 2 + 1] = model.edges[i].target;
		weights[i] = model.edges[i].weight;
	}
	return { type: "compute" as const, nodeCount: model.nodes.length, edges, weights };
}
