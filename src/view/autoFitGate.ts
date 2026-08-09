/**
 * One-shot latch deciding whether the camera should auto-frame the graph when
 * the layout settles. Requested on view open and on preset switch, cancelled
 * the moment the user pans or zooms by hand — their framing always wins.
 * Kept free of the Obsidian runtime so the decision can be unit-tested.
 */
export class AutoFitGate {
	private pending = false;

	/** Arm the latch: the next settled layout should be framed. */
	request(): void {
		this.pending = true;
	}

	/** The user moved the camera themselves — drop the pending auto-fit. */
	cancel(): void {
		this.pending = false;
	}

	/** Whether to fit now. Reading disarms the latch, so a fit runs only once. */
	consume(): boolean {
		const shouldFit = this.pending;
		this.pending = false;
		return shouldFit;
	}
}
