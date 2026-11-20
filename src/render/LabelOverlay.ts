import type { LabelId } from "./labelLayout";

export interface OverlayLabel {
	id: LabelId;
	text: string;
	x: number;
	y: number;
	scale: number;
	alpha: number;
	weight?: 500 | 600;
}

export interface LabelOverlayAppearance {
	fontFamily: string;
	fontSize: number;
	fill: string;
	halo: string;
}

interface OverlayEntry {
	element: HTMLSpanElement;
	seen: boolean;
	state: string;
}

function labelKey(id: LabelId): string {
	return `${typeof id}:${id}`;
}

/**
 * Browser-rendered labels stay sharp on Retina even when the WebGL scene uses
 * one render pixel per CSS pixel. Pixi text remains the source of measurements
 * and the PNG-export layer; this class only mirrors the visible result.
 */
export class LabelOverlay {
	private readonly root: HTMLDivElement;
	private readonly entries = new Map<string, OverlayEntry>();
	private readonly pixelRatio: number;
	private appearanceKey = "";

	constructor(host: HTMLElement) {
		this.root = host.createDiv({ cls: "graph-insight-label-layer" });
		Object.assign(this.root.style, {
			position: "absolute",
			inset: "0",
			overflow: "hidden",
			pointerEvents: "none",
			userSelect: "none",
			zIndex: "2",
			fontWeight: "500",
		});
		this.pixelRatio = Math.max(1, host.ownerDocument.defaultView?.devicePixelRatio ?? 1);
	}

	sync(labels: readonly OverlayLabel[], appearance: LabelOverlayAppearance): void {
		for (const entry of this.entries.values()) entry.seen = false;
		const appearanceKey = [appearance.fontFamily, appearance.fontSize, appearance.fill, appearance.halo].join("\u0000");
		if (appearanceKey !== this.appearanceKey) {
			this.appearanceKey = appearanceKey;
			this.root.style.fontFamily = appearance.fontFamily;
			this.root.style.color = appearance.fill;
			this.root.style.textShadow = [
				`-1px 0 0 ${appearance.halo}`,
				`1px 0 0 ${appearance.halo}`,
				`0 -1px 0 ${appearance.halo}`,
				`0 1px 0 ${appearance.halo}`,
				`0 0 2px ${appearance.halo}`,
			].join(", ");
		}
		for (const label of labels) {
			const key = labelKey(label.id);
			let entry = this.entries.get(key);
			if (!entry) {
				const element = this.root.createSpan({ cls: "graph-insight-label" });
				Object.assign(element.style, {
					position: "absolute",
					transform: "translateX(-50%)",
					transformOrigin: "50% 0",
					whiteSpace: "nowrap",
					lineHeight: "1.15",
					textRendering: "geometricPrecision",
				});
				entry = { element, seen: true, state: "" };
				this.entries.set(key, entry);
			}
			entry.seen = true;
			const element = entry.element;
			if (element.textContent !== label.text) element.textContent = label.text;
			const x = this.snap(label.x);
			const y = this.snap(label.y);
			const fontSize = appearance.fontSize * label.scale;
			const alpha = Math.max(0, Math.min(1, label.alpha));
			const weight = label.weight ?? 500;
			const state = `${x}\u0000${y}\u0000${fontSize}\u0000${alpha}\u0000${weight}`;
			if (state === entry.state) continue;
			entry.state = state;
			element.style.left = `${x}px`;
			element.style.top = `${y}px`;
			element.style.fontSize = `${fontSize}px`;
			element.style.opacity = String(alpha);
			element.style.fontWeight = String(weight);
		}
		for (const [key, entry] of this.entries) {
			if (entry.seen) continue;
			entry.element.remove();
			this.entries.delete(key);
		}
	}

	private snap(value: number): number {
		return this.pixelRatio > 1 ? Math.round(value * this.pixelRatio) / this.pixelRatio : value;
	}

	destroy(): void {
		this.entries.clear();
		this.root.remove();
	}
}
