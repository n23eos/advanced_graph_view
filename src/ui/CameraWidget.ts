/**
 * Bottom-right widget: a row of Obsidian-style icon toggles (hide UI, 3D,
 * free layout), fit / reset camera icon buttons and the Explore switch.
 * Panning lives on mouse gestures; the old X/Y sliders are gone (F-06).
 */
import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { View3DOptions } from "./ControlPanel";

export interface CameraWidgetCallbacks {
	onToggle3D(enabled: boolean): void;
	onToggleFreeLayout(enabled: boolean): void;
	/** Frame the whole graph; never touches orientation. */
	onFit(): void;
	/** Deterministic home view: zero pan/orbit/zoom, then fit. */
	onReset(): void;
	onToggleUI(hidden: boolean): void;
	onToggleExplore(): void;
}

export class CameraWidget {
	private root: HTMLElement;
	private button3d: HTMLButtonElement;
	private buttonFree: HTMLButtonElement;
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

		const fitButton = this.iconButton(header, "maximize", t("camera.fit"), () => this.callbacks.onFit());
		fitButton.addClass("graph-insight-camera-secondary");
		const resetButton = this.iconButton(header, "rotate-ccw", t("camera.reset"), () =>
			this.callbacks.onReset()
		);
		resetButton.addClass("graph-insight-camera-secondary");

		const body = this.root.createDiv();
		this.exploreButton = body.createEl("button", {
			text: t("camera.explore"),
			cls: "graph-insight-camera-fit graph-insight-camera-secondary",
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

	/** Keep in step when 3D/free-layout is toggled from the main panel. */
	sync(state3d: View3DOptions, freeLayout: boolean): void {
		this.button3d.toggleClass("is-active", state3d.enabled);
		this.buttonFree.toggleClass("is-active", freeLayout);
	}

	destroy(): void {
		this.root.remove();
	}
}
