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

	async flush(): Promise<void> {
		let failed = false;
		let failure: unknown;
		while (this.active || this.pending) {
			this.active ??= this.drain();
			try {
				await this.active;
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
		}
		if (failed) throw failure;
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
