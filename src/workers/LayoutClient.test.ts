import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildGraphModel } from "../data/GraphStore";
import { LayoutClient } from "./LayoutClient";

class FakeWorker {
	static instances: FakeWorker[] = [];
	static constructorError: Error | null = null;
	static postError: Error | null = null;

	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	terminated = false;

	constructor(_url: string | URL) {
		if (FakeWorker.constructorError) throw FakeWorker.constructorError;
		FakeWorker.instances.push(this);
	}

	postMessage(): void {
		if (FakeWorker.postError) throw FakeWorker.postError;
	}

	terminate(): void {
		this.terminated = true;
	}

	emitError(message: string): void {
		this.onerror?.({ message } as ErrorEvent);
	}
}

describe("LayoutClient startup failures", () => {
	const revoked: string[] = [];

	beforeEach(() => {
		FakeWorker.instances = [];
		FakeWorker.constructorError = null;
		FakeWorker.postError = null;
		revoked.length = 0;
		vi.stubGlobal("Worker", FakeWorker);
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:layout-test");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revoked.push(String(url)));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	test("reports a constructor failure once and revokes its blob URL", () => {
		FakeWorker.constructorError = new Error("worker blocked");
		const errors: string[] = [];
		const client = new LayoutClient(() => {}, () => {}, (reason) => errors.push(reason));

		expect(() => client.start(buildGraphModel(["a.md"], {}, {}))).not.toThrow();

		expect(errors).toEqual(["worker blocked"]);
		expect(revoked).toEqual(["blob:layout-test"]);
	});

	test("cleans up a worker whose initial post fails without reporting twice", () => {
		FakeWorker.postError = new Error("post failed");
		const errors: string[] = [];
		const client = new LayoutClient(() => {}, () => {}, (reason) => errors.push(reason));

		client.start(buildGraphModel(["a.md"], {}, {}));
		const worker = FakeWorker.instances[0];
		worker.emitError("late error");

		expect(worker.terminated).toBe(true);
		expect(errors).toEqual(["post failed"]);
		expect(revoked).toEqual(["blob:layout-test"]);
	});

	test("reports and cleans up a post failure after startup", () => {
		const errors: string[] = [];
		const client = new LayoutClient(() => {}, () => {}, (reason) => errors.push(reason));
		client.start(buildGraphModel(["a.md"], {}, {}));
		const worker = FakeWorker.instances[0];
		FakeWorker.postError = new Error("pin failed");

		expect(() => client.pin(0, 1, 2)).not.toThrow();

		expect(worker.terminated).toBe(true);
		expect(errors).toEqual(["pin failed"]);
		expect(revoked).toEqual(["blob:layout-test"]);
	});
});
