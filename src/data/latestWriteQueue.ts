/** Serialize writes to one file; an in-flight flush includes queued updates. */
export class LatestWriteQueue<T> {
	private pending: { value: T } | null = null;
	private active: Promise<void> | null = null;

	constructor(private readonly write: (value: T) => Promise<void>) {}

	enqueue(value: T): Promise<void> {
		this.pending = { value };
		this.active ??= this.drain();
		return this.active;
	}

	flush(): Promise<void> {
		return this.active ?? Promise.resolve();
	}

	private async drain(): Promise<void> {
		try {
			while (this.pending) {
				const { value } = this.pending;
				this.pending = null;
				await this.write(value);
			}
		} finally {
			this.active = null;
		}
	}
}
