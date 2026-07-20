/**
 * Structural graph metrics: PageRank + Louvain communities via graphology.
 * Runs inside metrics.worker.ts; pure module for unit testing.
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import pagerank from "graphology-metrics/centrality/pagerank";

export interface GraphMetricsResult {
	pagerank: Float32Array;
	community: Int32Array;
	communityCount: number;
}

export function computeGraphMetrics(
	nodeCount: number,
	edgePairs: Uint32Array,
	weights: Float32Array
): GraphMetricsResult {
	const graph = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
	for (let i = 0; i < nodeCount; i++) graph.addNode(i);
	for (let e = 0; e < weights.length; e++) {
		const source = edgePairs[e * 2];
		const target = edgePairs[e * 2 + 1];
		if (source === target) continue;
		graph.mergeEdge(source, target, { weight: weights[e] });
	}

	const rankById = pagerank(graph, { getEdgeWeight: "weight" });
	const pagerankOut = new Float32Array(nodeCount);
	for (let i = 0; i < nodeCount; i++) pagerankOut[i] = rankById[i] ?? 0;

	const communityById = louvain(graph, { getEdgeWeight: "weight" });
	const community = new Int32Array(nodeCount);
	let maxCommunity = -1;
	for (let i = 0; i < nodeCount; i++) {
		const id = communityById[i] ?? 0;
		community[i] = id;
		if (id > maxCommunity) maxCommunity = id;
	}

	return { pagerank: pagerankOut, community, communityCount: maxCommunity + 1 };
}
