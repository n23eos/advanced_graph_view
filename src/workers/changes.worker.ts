/**
 * Worker shell for the F-10 topology diff. Spawned from a Blob URL; keeps a
 * 250k-edge comparison off the UI thread.
 */
import { computeTopologyDiff, type TopologyDiff } from "../analysis/graphChanges";
import type { GraphSnapshot } from "../data/graphSnapshots";
import type { GraphModel } from "../data/GraphStore";

export interface ChangesRequest {
	type: "diff";
	snapshot: GraphSnapshot;
	paths: string[];
	inCounts: number[];
	edges: Array<[number, number]>;
	pagerank: number[] | null;
}

export interface ChangesResponse {
	type: "result";
	diff: TopologyDiff;
}

/** The lean model the diff needs, rebuilt from transferable arrays. */
export function liteModel(paths: string[], inCounts: number[], edges: Array<[number, number]>): GraphModel {
	return {
		nodes: paths.map((path, id) => ({
			id,
			path,
			name: path,
			inCount: inCounts[id] ?? 0,
			outCount: 0,
			unresolvedCount: 0,
		})),
		edges: edges.map(([source, target]) => ({ source, target, weight: 1 })),
		pathToId: new Map(),
	};
}

const workerScope = self as unknown as {
	postMessage(message: unknown): void;
	onmessage: ((event: MessageEvent<ChangesRequest>) => void) | null;
};

workerScope.onmessage = (event) => {
	const request = event.data;
	if (request.type !== "diff") return;
	const diff = computeTopologyDiff(
		request.snapshot,
		liteModel(request.paths, request.inCounts, request.edges),
		request.pagerank
	);
	const response: ChangesResponse = { type: "result", diff };
	workerScope.postMessage(response);
};
