/**
 * Worker shell for structural metrics. Spawned from a Blob URL.
 */
import { computeGraphMetrics } from "./metricsEngine";

export interface MetricsRequest {
	type: "compute";
	nodeCount: number;
	edges: Uint32Array;
	weights: Float32Array;
}

export interface MetricsResponse {
	type: "result";
	pagerank: Float32Array;
	community: Int32Array;
	communityCount: number;
}

const workerScope = self as unknown as {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<MetricsRequest>) => void) | null;
};

workerScope.onmessage = (event) => {
	const request = event.data;
	if (request.type !== "compute") return;
	const result = computeGraphMetrics(request.nodeCount, request.edges, request.weights);
	const response: MetricsResponse = { type: "result", ...result };
	workerScope.postMessage(response, [result.pagerank.buffer, result.community.buffer]);
};
