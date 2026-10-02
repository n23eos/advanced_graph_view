import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphModel } from "../data/GraphStore";
import type { MetricsResponse } from "./metrics.worker";
import { MetricsClient, type GraphMetrics } from "./MetricsClient";

class FakeWorker {
	static instances: FakeWorker[] = [];

	onmessage: ((event: MessageEvent<MetricsResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly messages: unknown[] = [];

	constructor(_url: string | URL) {
		FakeWorker.instances.push(this);
	}

	postMessage(message: unknown): void {
		this.messages.push(message);
	}

	terminate(): void {}

	emit(response: MetricsResponse): void {
		this.onmessage?.({ data: response } as MessageEvent<MetricsResponse>);
	}
}

function model(weight: number): GraphModel {
	return {
		nodes: [
			{ id: 0, path: "a.md", name: "a", inCount: 0, outCount: 1, unresolvedCount: 0 },
			{ id: 1, path: "b.md", name: "b", inCount: 1, outCount: 0, unresolvedCount: 0 },
		],
		edges: [{ source: 0, target: 1, weight }],
		pathToId: new Map([["a.md", 0], ["b.md", 1]]),
	};
}

function response(rank: number): MetricsResponse {
	return {
		type: "result",
		pagerank: new Float32Array([rank, 1 - rank]),
		community: new Int32Array([0, 0]),
		communityCount: 1,
	};
}

describe("MetricsClient", () => {
	beforeEach(() => {
		FakeWorker.instances = [];
		vi.stubGlobal("Worker", FakeWorker);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("publishes only the latest result when a newer model is pending", () => {
		const received: GraphMetrics[] = [];
		const client = new MetricsClient((metrics) => received.push(metrics));

		client.compute(model(1));
		client.compute(model(2));
		const worker = FakeWorker.instances[0];

		worker.emit(response(0.75));

		expect(received).toEqual([]);
		expect(worker.messages).toHaveLength(2);

		worker.emit(response(0.25));

		expect(received).toHaveLength(1);
		expect(Array.from(received[0].pagerank)).toEqual([0.25, 0.75]);
	});
});
