import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphModel } from "../data/GraphStore";
import type { MetricsResponse } from "./metrics.worker";
import { MetricsClient, type GraphMetrics } from "./MetricsClient";

class FakeWorker {
	static instances: FakeWorker[] = [];
	static constructorError: Error | null = null;
	static postError: Error | null = null;

	onmessage: ((event: MessageEvent<MetricsResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly messages: unknown[] = [];
	terminated = false;

	constructor(_url: string | URL) {
		if (FakeWorker.constructorError) throw FakeWorker.constructorError;
		FakeWorker.instances.push(this);
	}

	postMessage(message: unknown): void {
		if (FakeWorker.postError) throw FakeWorker.postError;
		this.messages.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(response: MetricsResponse): void {
		this.onmessage?.({ data: response } as MessageEvent<MetricsResponse>);
	}

	emitError(message: string): void {
		this.onerror?.({ message } as ErrorEvent);
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
		FakeWorker.constructorError = null;
		FakeWorker.postError = null;
		vi.stubGlobal("Worker", FakeWorker);
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
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

	test("reports a constructor failure once and revokes its blob URL", () => {
		FakeWorker.constructorError = new Error("worker blocked");
		const revoked: string[] = [];
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:metrics-test");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revoked.push(String(url)));
		const errors: string[] = [];
		const client = new MetricsClient(() => {}, (reason) => errors.push(reason));

		expect(() => client.compute(model(1))).not.toThrow();

		expect(errors).toEqual(["worker blocked"]);
		expect(revoked).toEqual(["blob:metrics-test"]);
	});

	test("cleans up a worker whose post fails without reporting twice", () => {
		FakeWorker.postError = new Error("post failed");
		const revoked: string[] = [];
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:metrics-test");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revoked.push(String(url)));
		const errors: string[] = [];
		const client = new MetricsClient(() => {}, (reason) => errors.push(reason));

		client.compute(model(1));
		const worker = FakeWorker.instances[0];
		worker.emitError("late error");

		expect(worker.terminated).toBe(true);
		expect(errors).toEqual(["post failed"]);
		expect(revoked).toEqual(["blob:metrics-test"]);
	});
});
