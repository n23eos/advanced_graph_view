/**
 * Top-right color panel: scale preset, custom two-color gradient with
 * in-place pickers, and a contrast (gamma) slider. Collapsible.
 */
import { SCALE_PRESETS } from "../encoding/colorScales";
import type { ColorTuningState } from "./ControlPanel";

export interface ColorPanelCallbacks {
	onChange(state: ColorTuningState): void;
}

export class ColorPanel {
	private root: HTMLElement;
	private body: HTMLElement;
	private collapsed = true;
	private chevron: HTMLElement;

	constructor(
		host: HTMLElement,
		private state: ColorTuningState,
		private readonly callbacks: ColorPanelCallbacks
	) {
		this.root = host.createDiv({ cls: "graph-insight-clusters" });
		const header = this.root.createDiv({ cls: "graph-insight-panel-header" });
		this.chevron = header.createSpan({ cls: "graph-insight-panel-chevron", text: "▸" });
		header.createSpan({ text: "Цвета" });
		header.addEventListener("click", () => {
			this.collapsed = !this.collapsed;
			this.applyCollapsed();
		});

		this.body = this.root.createDiv({ cls: "graph-insight-colorpanel-body" });
		this.renderBody();
		this.applyCollapsed();
	}

	private emit(): void {
		this.callbacks.onChange(this.state);
	}

	private applyCollapsed(): void {
		this.body.toggleClass("is-hidden", this.collapsed);
		this.chevron.setText(this.collapsed ? "▸" : "▾");
	}

	private renderBody(): void {
		this.body.empty();

		const presetRow = this.body.createDiv({ cls: "graph-insight-panel-row" });
		presetRow.createSpan({ cls: "graph-insight-panel-label", text: "Шкала" });
		const select = presetRow.createEl("select", { cls: "dropdown" });
		for (const [id, preset] of Object.entries(SCALE_PRESETS)) {
			const option = select.createEl("option", { text: preset.label, value: id });
			option.selected = !this.state.useCustom && this.state.preset === id;
		}
		const custom = select.createEl("option", { text: "Свой градиент", value: "__custom__" });
		custom.selected = this.state.useCustom;
		select.addEventListener("change", () => {
			if (select.value === "__custom__") {
				this.state = { ...this.state, useCustom: true };
			} else {
				this.state = { ...this.state, useCustom: false, preset: select.value };
			}
			this.emit();
		});

		const colorsRow = this.body.createDiv({ cls: "graph-insight-panel-row" });
		colorsRow.createSpan({ cls: "graph-insight-panel-label", text: "Мин → Макс" });
		const pickers = colorsRow.createSpan({ cls: "graph-insight-colorpanel-pickers" });
		const fromInput = pickers.createEl("input", { type: "color" });
		fromInput.value = this.state.customFrom;
		const toInput = pickers.createEl("input", { type: "color" });
		toInput.value = this.state.customTo;
		const onPick = () => {
			this.state = {
				...this.state,
				useCustom: true,
				customFrom: fromInput.value,
				customTo: toInput.value,
			};
			custom.selected = true;
			this.emit();
		};
		fromInput.addEventListener("input", onPick);
		toInput.addEventListener("input", onPick);

		const gammaRow = this.body.createDiv({ cls: "graph-insight-panel-row" });
		gammaRow.createSpan({ cls: "graph-insight-panel-label", text: "Контраст" });
		const gammaValue = gammaRow.createSpan({
			cls: "graph-insight-panel-count",
			text: this.state.gamma.toFixed(2),
		});
		const gamma = this.body.createEl("input", { type: "range" });
		gamma.min = "0.3";
		gamma.max = "3";
		gamma.step = "0.05";
		gamma.value = String(this.state.gamma);
		gamma.addEventListener("input", () => {
			this.state = { ...this.state, gamma: Number(gamma.value) };
			gammaValue.setText(this.state.gamma.toFixed(2));
			this.emit();
		});
	}

	destroy(): void {
		this.root.remove();
	}
}
