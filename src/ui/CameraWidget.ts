/**
 * Bottom-right widget: eye (hide all UI), 3D toggle, free-layout toggle,
 * camera center X/Y sliders and a fit-all button.
 */
import type { View3DOptions } from "./ControlPanel";

export interface CameraWidgetCallbacks {
	onToggle3D(enabled: boolean): void;
	onToggleFreeLayout(enabled: boolean): void;
	onOffsetChange(x: number, y: number): void;
	onFit(): void;
	onToggleUI(hidden: boolean): void;
}

const OFFSET_RANGE = 600;

export class CameraWidget {
	private root: HTMLElement;
	private body: HTMLElement;
	private checkbox3d: HTMLInputElement;
	private checkboxFree: HTMLInputElement;
	private sliderX: HTMLInputElement;
	private sliderY: HTMLInputElement;
	private uiHidden = false;

	constructor(
		host: HTMLElement,
		state3d: View3DOptions,
		freeLayout: boolean,
		private readonly callbacks: CameraWidgetCallbacks
	) {
		this.root = host.createDiv({ cls: "graph-insight-camera" });

		const header = this.root.createDiv({ cls: "graph-insight-camera-row" });
		const eye = header.createEl("button", { text: "👁", cls: "graph-insight-camera-eye" });
		eye.setAttribute("aria-label", "Hide or show all panels");
		eye.addEventListener("click", () => {
			this.uiHidden = !this.uiHidden;
			eye.toggleClass("is-ui-hidden", this.uiHidden);
			this.callbacks.onToggleUI(this.uiHidden);
		});

		const label3d = header.createEl("label", { cls: "graph-insight-panel-checkbox" });
		this.checkbox3d = label3d.createEl("input", { type: "checkbox" });
		this.checkbox3d.checked = state3d.enabled;
		label3d.createSpan({ text: "3D" });
		this.checkbox3d.addEventListener("change", () => {
			this.callbacks.onToggle3D(this.checkbox3d.checked);
		});

		const labelFree = header.createEl("label", { cls: "graph-insight-panel-checkbox" });
		this.checkboxFree = labelFree.createEl("input", { type: "checkbox" });
		this.checkboxFree.checked = freeLayout;
		labelFree.createSpan({ text: "Free" });
		this.checkboxFree.addEventListener("change", () => {
			this.callbacks.onToggleFreeLayout(this.checkboxFree.checked);
		});

		this.body = this.root.createDiv();

		this.sliderX = this.offsetSlider("X");
		this.sliderY = this.offsetSlider("Y");

		const fit = this.body.createEl("button", { text: "Fit whole graph", cls: "graph-insight-camera-fit" });
		fit.addEventListener("click", () => {
			this.sliderX.value = "0";
			this.sliderY.value = "0";
			this.callbacks.onFit();
		});
	}

	private offsetSlider(label: string): HTMLInputElement {
		const row = this.body.createDiv({ cls: "graph-insight-camera-row" });
		row.createSpan({ cls: "graph-insight-camera-label", text: label });
		const slider = row.createEl("input", { type: "range" });
		slider.min = String(-OFFSET_RANGE);
		slider.max = String(OFFSET_RANGE);
		slider.step = "10";
		slider.value = "0";
		slider.addEventListener("input", () => {
			this.callbacks.onOffsetChange(Number(this.sliderX.value), Number(this.sliderY.value));
		});
		return slider;
	}

	/** Keep in step when 3D/free-layout is toggled from the main panel. */
	sync(state3d: View3DOptions, freeLayout: boolean): void {
		this.checkbox3d.checked = state3d.enabled;
		this.checkboxFree.checked = freeLayout;
	}

	destroy(): void {
		this.root.remove();
	}
}
