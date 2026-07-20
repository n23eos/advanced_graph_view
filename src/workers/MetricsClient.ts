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

	constructor(private readonly onResult: (metrics: GraphMetrics) => void) {}

	compute(model: GraphModel): void {
		if (this.computing) {
			this.pendingModel = model;
			return;
		}
		this.computing = true;
		this.ensureWorker().postMessage(buildRequest(model));
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		const blob = new Blob([metricsWorkerSource], { type: "text/javascript" });
		this.blobUrl = URL.createObjectURL(blob);
		this.worker = new Worker(this.blobUrl);
		this.worker.onmessage = (event: MessageEvent<MetricsResponse>) => {
			if (!this.worker) return; // stopped mid-flight
			this.computing = false;
			const { pagerank, community, communityCount } = event.data;
			this.onResult({ pagerank, community, communityCount });
			if (this.pendingModel) {
				const next = this.pendingModel;
				this.pendingModel = null;
				this.compute(next);
			}
		};
		return this.worker;
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
		this.computing = false;
		this.pendingModel = null;
	}
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
