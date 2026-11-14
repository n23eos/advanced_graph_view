import { expect, test, vi } from "vitest";
import { LatestWriteQueue } from "./latestWriteQueue";

test("coalesces pending snapshots and waits for the final write", async () => {
	const completions: Array<() => void> = [];
	const write = vi.fn((_value: number) => new Promise<void>((resolve) => completions.push(resolve)));
	const queue = new LatestWriteQueue(write);
	const first = queue.enqueue(1);
	const middle = queue.enqueue(2);
	const last = queue.enqueue(3);
	expect(write.mock.calls).toEqual([[1]]);
	completions[0]();
	await vi.waitFor(() => expect(write.mock.calls).toEqual([[1], [3]]));
	let done = false;
	const flushed = queue.flush().then(() => { done = true; });
	await Promise.resolve();
	expect(done).toBe(false);
	completions[1]();
	await Promise.all([first, middle, last, flushed]);
	expect(done).toBe(true);
});

test("a rejected write releases the queue for a later attempt", async () => {
	const write = vi.fn<(value: number) => Promise<void>>()
		.mockRejectedValueOnce(new Error("disk unavailable"))
		.mockResolvedValueOnce(undefined);
	const queue = new LatestWriteQueue(write);
	await expect(queue.enqueue(1)).rejects.toThrow("disk unavailable");
	await expect(queue.enqueue(2)).resolves.toBeUndefined();
	expect(write.mock.calls).toEqual([[1], [2]]);
});

test("flush after a rejected write drains only the latest pending value", async () => {
	let rejectFirst!: (error: Error) => void;
	const write = vi.fn<(value: number) => Promise<void>>()
		.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
		.mockResolvedValue(undefined);
	const queue = new LatestWriteQueue(write);
	const first = queue.enqueue(1);
	const middle = queue.enqueue(2);
	const latest = queue.enqueue(3);
	rejectFirst(new Error("disk unavailable"));
	await expect(first).rejects.toThrow("disk unavailable");
	await expect(middle).rejects.toThrow("disk unavailable");
	await expect(latest).rejects.toThrow("disk unavailable");
	await expect(queue.flush()).resolves.toBeUndefined();
	expect(write.mock.calls).toEqual([[1], [3]]);
});

test("an in-flight flush drains pending data before preserving the active error", async () => {
	let rejectFirst!: (error: Error) => void;
	const write = vi.fn<(value: number) => Promise<void>>()
		.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
		.mockResolvedValue(undefined);
	const queue = new LatestWriteQueue(write);
	const first = queue.enqueue(1);
	const queued = queue.enqueue(2);
	const flushed = queue.flush();
	rejectFirst(new Error("disk unavailable"));
	await expect(first).rejects.toThrow("disk unavailable");
	await expect(queued).rejects.toThrow("disk unavailable");
	await expect(flushed).rejects.toThrow("disk unavailable");
	expect(write.mock.calls).toEqual([[1], [2]]);
});

test("a synchronous write failure releases the queue before a later flush", async () => {
	const write = vi.fn<(value: number) => Promise<void>>()
		.mockImplementationOnce(() => { throw new Error("sync failure"); })
		.mockResolvedValueOnce(undefined);
	const queue = new LatestWriteQueue(write);
	await expect(queue.enqueue(1)).rejects.toThrow("sync failure");
	await expect(queue.enqueue(2)).resolves.toBeUndefined();
	await expect(queue.flush()).resolves.toBeUndefined();
	expect(write.mock.calls).toEqual([[1], [2]]);
});
