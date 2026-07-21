/**
 * Pilot mode heads-up display: a fixed center crosshair, a reticle that snaps
 * to the node under the crosshair, and an instrument panel (bottom-center)
 * showing the targeted note's title, link count and cluster, plus a throttle
 * bar. Pure DOM over the canvas; PilotMode feeds it every frame.
 */

export interface PilotTarget {
	title: string;
	links: number;
	cluster: string;
}

export class PilotHud {
	private root: HTMLElement;
	private crosshair: HTMLElement;
	private reticle: HTMLElement;
	private throttleFill: HTMLElement;
	private targetTitle: HTMLElement;
	private targetMeta: HTMLElement;
	private preview: HTMLElement;
	private lastTitle: string | null = null;

	constructor(host: HTMLElement) {
		this.root = host.createDiv({ cls: "graph-insight-hud" });

		// Canopy frame: corner struts + inner vignette to feel enclosed.
		this.root.createDiv({ cls: "graph-insight-hud-cockpit" });
		this.crosshair = this.root.createDiv({ cls: "graph-insight-hud-crosshair" });
		this.reticle = this.root.createDiv({ cls: "graph-insight-hud-reticle" });
		this.reticle.hide();

		const panel = this.root.createDiv({ cls: "graph-insight-hud-panel" });
		this.targetTitle = panel.createDiv({ cls: "graph-insight-hud-title", text: "— no target —" });
		this.targetMeta = panel.createDiv({ cls: "graph-insight-hud-meta" });
		this.preview = panel.createDiv({ cls: "graph-insight-hud-preview" });
		const throttle = panel.createDiv({ cls: "graph-insight-hud-throttle" });
		this.throttleFill = throttle.createDiv({ cls: "graph-insight-hud-throttle-fill" });

		this.root.createDiv({
			cls: "graph-insight-hud-hint",
			text: "aim with crosshair · push to edges to turn · WASD move · Space/C up/down · left-hold tractor · F open · Esc",
		});
		this.hide();
	}

	show(): void {
		this.root.show();
	}

	hide(): void {
		this.root.hide();
	}

	/** Update the instrument readout; only touches the DOM when it changes. */
	setTarget(target: PilotTarget | null): void {
		const title = target?.title ?? null;
		if (title === this.lastTitle) return;
		this.lastTitle = title;
		if (!target) {
			this.targetTitle.setText("— no target —");
			this.targetMeta.setText("");
			return;
		}
		this.targetTitle.setText(target.title);
		const cluster = target.cluster ? ` · ${target.cluster}` : "";
		this.targetMeta.setText(`${target.links} link${target.links === 1 ? "" : "s"}${cluster}`);
	}

	/** Note excerpt for the targeted planet; empty string clears it. */
	setPreview(text: string): void {
		this.preview.setText(text);
		this.preview.toggleClass("is-empty", text.length === 0);
	}

	/** Position the free crosshair at the cursor (canvas coords). */
	setCrosshair(x: number, y: number): void {
		this.crosshair.style.left = `${x}px`;
		this.crosshair.style.top = `${y}px`;
	}

	/** Move the reticle onto a node (canvas coords + radius), or hide it.
	 *  `towing` switches it to the active tractor-beam look. */
	setReticle(pos: { x: number; y: number; r: number } | null, towing = false): void {
		if (!pos) {
			this.reticle.hide();
			return;
		}
		const size = Math.max(24, pos.r * 2 + 14);
		this.reticle.style.width = `${size}px`;
		this.reticle.style.height = `${size}px`;
		this.reticle.style.left = `${pos.x}px`;
		this.reticle.style.top = `${pos.y}px`;
		this.reticle.toggleClass("is-towing", towing);
		this.reticle.show();
	}

	/** Throttle bar, 0..1 of current speed. */
	setThrottle(fraction: number): void {
		this.throttleFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
	}

	destroy(): void {
		this.root.remove();
	}
}
