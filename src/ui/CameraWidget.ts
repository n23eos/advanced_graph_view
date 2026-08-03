/**
 * Bottom-right widget: a row of Obsidian-style icon toggles (hide UI, 3D,
 * free layout), camera center X/Y sliders and a fit-all button.
 */
import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { View3DOptions } from "./ControlPanel";

export interface CameraWidgetCallbacks {
	onToggle3D(enabled: boolean): void;
	onToggleFreeLayout(enabled: boolean): void;
	onOffsetChange(x: number, y: number): void;
	onFit(): void;
	onToggleUI(hidden: boolean): void;
	onToggleExplore(): void;
}

const OFFSET_RANGE = 600;

export class CameraWidget {
	private root: HTMLElement;
	private body: HTMLElement;
	private button3d: HTMLButtonElement;
	private buttonFree: HTMLButtonElement;
	private sliderX: HTMLInputElement;
	private sliderY: HTMLInputElement;
	private exploreButton: HTMLElement;
	private uiHidden = false;

	constructor(
		host: HTMLElement,
		state3d: View3DOptions,
		freeLayout: boolean,
		private readonly callbacks: CameraWidgetCallbacks
	) {
		this.root = host.createDiv({ cls: "graph-insight-camera" });

		const header = this.root.createDiv({ cls: "graph-insight-camera-row" });

		const eye = this.iconButton(header, "eye", t("camera.toggleUi"), () => {
			this.uiHidden = !this.uiHidden;
			setIcon(eye, this.uiHidden ? "eye-off" : "eye");
			this.callbacks.onToggleUI(this.uiHidden);
		});

		this.button3d = this.iconButton(header, "rotate-3d", t("camera.threeD"), () => {
			this.callbacks.onToggle3D(!this.button3d.hasClass("is-active"));
		});
		this.button3d.toggleClass("is-active", state3d.enabled);

		this.buttonFree = this.iconButton(header, "expand", t("camera.free"), () => {
			this.callbacks.onToggleFreeLayout(!this.buttonFree.hasClass("is-active"));
		});
		this.buttonFree.toggleClass("is-active", freeLayout);

		this.body = this.root.createDiv();

		this.sliderX = this.offsetSlider("X");
		this.sliderY = this.offsetSlider("Y");

		const fit = this.body.createEl("button", { text: t("camera.fit"), cls: "graph-insight-camera-fit" });
		fit.addEventListener("click", () => {
			this.sliderX.value = "0";
			this.sliderY.value = "0";
			this.callbacks.onFit();
		});

		this.exploreButton = this.body.createEl("button", {
			text: t("camera.explore"),
			cls: "graph-insight-camera-fit",
		});
		this.exploreButton.setAttribute("aria-label", t("camera.explore.hint"));
		this.exploreButton.addEventListener("click", () => this.callbacks.onToggleExplore());
	}

	/** Light up the button while the mode is running, so it reads as a state
	 *  and not as a one-shot action. */
	setExploring(active: boolean): void {
		this.exploreButton.toggleClass("is-active", active);
	}

	private iconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void
	): HTMLButtonElement {
		const button = parent.createEl("button", { cls: "clickable-icon graph-insight-camera-icon" });
		setIcon(button, icon);
		button.setAttribute("aria-label", label);
		button.addEventListener("click", onClick);
		return button;
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
		this.button3d.toggleClass("is-active", state3d.enabled);
		this.buttonFree.toggleClass("is-active", freeLayout);
	}

	destroy(): void {
		this.root.remove();
	}
}
