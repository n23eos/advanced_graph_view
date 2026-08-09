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

/**
 * Main-view settle decision: fit only in 2D. The 3D galaxy is tuned to be
 * seen from its center — flying the camera out far enough to frame the whole
 * vault drops every node into the depth fog and the size floor, and the graph
 * reads as unlit dust. In 3D the pending fit is dropped, not kept, so a later
 * switch to 2D does not fire a stale one. (The local pane fits in 3D on
 * purpose: its neighborhood cloud is small, so the camera stays close.)
 */
export function shouldFitOnSettle(gate: AutoFitGate, view3dEnabled: boolean): boolean {
	if (view3dEnabled) {
		gate.cancel();
		return false;
	}
	return gate.consume();
}
