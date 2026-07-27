/**
 * Floating control panel: metric-to-channel assignment, overlay toggles,
 * cluster list. Native DOM + Obsidian CSS variables, no framework.
 */
import { t } from "../i18n";
import type { ChannelAssignment } from "../encoding/encode";
import type { LayoutRule } from "../workers/layoutEngine";
import { type MetricId, type NumericMetricId } from "../encoding/metrics";
import {
	categoricalMetricOptions,
	numericMetricOptions,
	scaleOptions,
} from "../encoding/metricLabels";
import { DEFAULT_PRESET_ID } from "../encoding/colorScales";
import type { OverlayCounts, OverlayToggles } from "../analysis/overlays";
import type { PhysicsParams } from "../workers/layoutEngine";

export interface PanelState {
	channels: ChannelAssignment;
	colorPreset: string;
	collapsed: boolean;
	overlays: OverlayToggles;
	showBubbles: boolean;
	showTimeline: boolean;
	showTrail: boolean;
	physics: PhysicsParams;
	labels: LabelOptions;
	edges: EdgeStyleOptions;
	/** Multiplier on node circle radius. */
	nodeScale: number;
	view3d: View3DOptions;
}

export interface View3DOptions {
	enabled: boolean;
	depthSource: "physics" | "cluster" | "age";
	/** Camera focal length: lower = stronger perspective. */
	focal: number;
}

export interface LabelOptions {
	/** Master switch: off hides every label regardless of the other options. */
	show: boolean;
	fontSize: number;
	/** Zoom level at which labels start to appear. */
	zoomThreshold: number;
	/** Cap on simultaneously visible labels. */
	maxCount: number;
	/** true: labels shrink with zoom-out and hide when unreadable (scamin). */
	scaleWithZoom: boolean;
}

export interface EdgeStyleOptions {
	show: boolean;
	width: number;
	opacity: number;
}

export interface ClusterRow {
	name: string;
	size: number;
	hidden: boolean;
}

export interface ViewPresetRow {
	name: string;
}

export interface PanelCallbacks {
	onPresetApply(index: number): void;
	/** Host opens its own naming dialog (window.prompt is not allowed). */
	onPresetSaveRequest(): void;
	onPresetDelete(index: number): void;
	onChange(state: PanelState): void;
	onReheat(): void;
	/** Change what pulls notes together: links, shared tag, or shared folder. */
	onLayoutRule(rule: LayoutRule): void;
	onClusterClick(index: number): void;
	onClusterToggle(index: number): void;
	onTrailReplay(): void;
	onShowHiddenNodes(): void;
	/** Clear every selection, highlight, focus, filter and hidden node. */
	onResetViewState(): void;
}

const NONE_VALUE = "__none__";
const OVERLAY_KEYS: Record<keyof OverlayToggles, "layers.orphans" | "layers.deadEnds" | "layers.broken"> = {
	orphans: "layers.orphans",
	deadEnds: "layers.deadEnds",
	broken: "layers.broken",
};

export class ControlPanel {
	private root: HTMLElement;
	private body: HTMLElement;
	private overlayCountEls = new Map<keyof OverlayToggles, HTMLElement>();
	private presetSelect: HTMLSelectElement | null = null;
	private viewPresets: ViewPresetRow[] = [];
	private selectedPresetIndex: number | null = null;
	private hiddenCountEl: HTMLElement | null = null;

	constructor(
		host: HTMLElement,
		private state: PanelState,
		private readonly callbacks: PanelCallbacks
	) {
		this.root = host.createDiv({ cls: "graph-insight-panel" });

		const header = this.root.createDiv({ cls: "graph-insight-panel-header" });
		header.createSpan({ text: t("panel.title") });
		const toggle = header.createSpan({ cls: "graph-insight-panel-toggle", text: state.collapsed ? "+" : "–" });
		header.addEventListener("click", () => {
			this.setState({ ...this.state, collapsed: !this.state.collapsed });
			toggle.setText(this.state.collapsed ? "+" : "–");
		});

		this.body = this.root.createDiv({ cls: "graph-insight-panel-body" });
		this.renderBody();
		this.applyCollapsed();
	}

	private setState(next: PanelState): void {
		this.state = next;
		this.applyCollapsed();
		this.callbacks.onChange(next);
	}

	private applyCollapsed(): void {
		this.body.toggleClass("is-hidden", this.state.collapsed);
	}

	private renderBody(): void {
		this.body.empty();
		this.overlayCountEls.clear();

		const presets = this.section("presets", t("panel.section.presets"));
		const presetRow = presets.createDiv({ cls: "graph-insight-panel-row" });
		this.presetSelect = presetRow.createEl("select", { cls: "dropdown" });
		this.presetSelect.addEventListener("change", () => {
			const index = Number(this.presetSelect!.value);
			if (!Number.isNaN(index) && this.presetSelect!.value !== "") {
				this.selectedPresetIndex = index;
				this.callbacks.onPresetApply(index);
			} else {
				this.selectedPresetIndex = null;
			}
		});
		const presetButtons = presets.createDiv({ cls: "graph-insight-panel-row" });
		const saveButton = presetButtons.createEl("button", { text: t("presets.save") });
		saveButton.addEventListener("click", () => this.callbacks.onPresetSaveRequest());
		const deleteButton = presetButtons.createEl("button", { text: t("presets.delete") });
		deleteButton.addEventListener("click", () => {
			const index = Number(this.presetSelect!.value);
			if (this.presetSelect!.value !== "" && !Number.isNaN(index)) {
				this.callbacks.onPresetDelete(index);
			}
		});
		this.renderPresetOptions();

		const view = this.section("appearance", t("panel.section.appearance"));
		this.channelSelect(view, t("appearance.size"), this.state.channels.size, numericMetricOptions(), (value) => {
			this.setState({ ...this.state, channels: { ...this.state.channels, size: value as NumericMetricId | null } });
		});
		this.channelSelect(
			view,
			t("appearance.color"),
			this.state.channels.color,
			{ ...numericMetricOptions(), ...categoricalMetricOptions() },
			(value) => {
				this.setState({ ...this.state, channels: { ...this.state.channels, color: value as MetricId | null } });
			}
		);
		this.channelSelect(view, t("appearance.glow"), this.state.channels.glow, numericMetricOptions(), (value) => {
			this.setState({ ...this.state, channels: { ...this.state.channels, glow: value as NumericMetricId | null } });
		});

		this.channelSelect(view, t("appearance.colorScheme"), this.state.colorPreset, scaleOptions(), (value) => {
			this.setState({ ...this.state, colorPreset: value ?? DEFAULT_PRESET_ID });
		}, false);

		if (!this.state.channels.color) {
			view.createDiv({
				cls: "graph-insight-panel-hint",
				text: t("appearance.colorHint"),
			});
		}

		this.physicsSlider(view, t("appearance.nodeSize"), 0.1, 2.5, 0.05, this.state.nodeScale, (value) => {
			this.setState({ ...this.state, nodeScale: value });
		});

		const textSection = this.section("labels", t("panel.section.labels"));
		this.checkboxRow(textSection, t("labels.show"), this.state.labels.show, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, show: value } });
		});
		this.physicsSlider(textSection, t("labels.size"), 6, 18, 0.5, this.state.labels.fontSize, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, fontSize: value } });
		});
		this.physicsSlider(textSection, t("labels.zoom"), 0.1, 2, 0.01, this.state.labels.zoomThreshold, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, zoomThreshold: value } });
		});
		this.physicsSlider(textSection, t("labels.max"), 5, 400, 5, this.state.labels.maxCount, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, maxCount: value } });
		});
		this.checkboxRow(textSection, t("labels.scaleWithZoom"), this.state.labels.scaleWithZoom, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, scaleWithZoom: value } });
		});

		const edgeSection = this.section("links", t("panel.section.links"));
		this.checkboxRow(edgeSection, t("edges.show"), this.state.edges.show, (value) => {
			this.setState({ ...this.state, edges: { ...this.state.edges, show: value } });
		});
		this.physicsSlider(edgeSection, t("edges.width"), 0.05, 2, 0.05, this.state.edges.width, (value) => {
			this.setState({ ...this.state, edges: { ...this.state.edges, width: value } });
		});
		this.physicsSlider(edgeSection, t("edges.opacity"), 0.02, 1, 0.01, this.state.edges.opacity, (value) => {
			this.setState({ ...this.state, edges: { ...this.state.edges, opacity: value } });
		});

		const threeD = this.section("threeD", t("panel.section.threeD"));
		this.checkboxRow(threeD, t("view3d.enabled"), this.state.view3d.enabled, (value) => {
			this.setState({ ...this.state, view3d: { ...this.state.view3d, enabled: value } });
		});
		this.channelSelect(
			threeD,
			t("view3d.depth"),
			this.state.view3d.depthSource,
			{
				physics: t("view3d.depth.physics"),
				cluster: t("view3d.depth.cluster"),
				age: t("view3d.depth.age"),
			},
			(value) => {
				this.setState({
					...this.state,
					view3d: { ...this.state.view3d, depthSource: (value ?? "physics") as View3DOptions["depthSource"] },
				});
			},
			false
		);
		this.physicsSlider(threeD, t("view3d.focal"), 300, 2500, 50, this.state.view3d.focal, (value) => {
			this.setState({ ...this.state, view3d: { ...this.state.view3d, focal: value } });
		});
		threeD.createDiv({
			cls: "graph-insight-panel-hint",
			text: t("view3d.hint"),
		});

		const layers = this.section("layers", t("panel.section.layers"));
		layers.createDiv({
			cls: "graph-insight-panel-hint",
			text: t("layers.hint"),
		});
		for (const key of Object.keys(OVERLAY_KEYS) as (keyof OverlayToggles)[]) {
			const row = layers.createDiv({ cls: "graph-insight-panel-row" });
			const label = row.createEl("label", { cls: "graph-insight-panel-checkbox" });
			const checkbox = label.createEl("input", { type: "checkbox" });
			checkbox.checked = this.state.overlays[key];
			label.createSpan({ text: t(OVERLAY_KEYS[key]) });
			const count = row.createSpan({ cls: "graph-insight-panel-count", text: "" });
			this.overlayCountEls.set(key, count);
			checkbox.addEventListener("change", () => {
				this.setState({
					...this.state,
					overlays: { ...this.state.overlays, [key]: checkbox.checked },
				});
			});
		}

		const hiddenRow = layers.createDiv({ cls: "graph-insight-panel-row" });
		hiddenRow.createSpan({ cls: "graph-insight-panel-label", text: t("layers.hidden") });
		this.hiddenCountEl = hiddenRow.createSpan({ cls: "graph-insight-panel-count", text: "0" });
		const showHidden = hiddenRow.createEl("button", { text: t("layers.showAll"), cls: "graph-insight-searchbar-btn" });
		showHidden.addEventListener("click", () => this.callbacks.onShowHiddenNodes());

		const resetButton = layers.createEl("button", { text: t("layers.reset") });
		resetButton.addEventListener("click", () => this.callbacks.onResetViewState());

		const timelineRow = layers.createDiv({ cls: "graph-insight-panel-row" });
		const timelineLabel = timelineRow.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const timelineCheckbox = timelineLabel.createEl("input", { type: "checkbox" });
		timelineCheckbox.checked = this.state.showTimeline;
		timelineLabel.createSpan({ text: t("layers.timeline") });
		timelineCheckbox.addEventListener("change", () => {
			this.setState({ ...this.state, showTimeline: timelineCheckbox.checked });
		});

		const trailRow = layers.createDiv({ cls: "graph-insight-panel-row" });
		const trailLabel = trailRow.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const trailCheckbox = trailLabel.createEl("input", { type: "checkbox" });
		trailCheckbox.checked = this.state.showTrail;
		trailLabel.createSpan({ text: t("layers.trail") });
		const replay = trailRow.createEl("button", { text: "⟲", cls: "graph-insight-searchbar-btn" });
		replay.setAttribute("aria-label", t("layers.trailReplay"));
		replay.addEventListener("click", () => this.callbacks.onTrailReplay());
		trailCheckbox.addEventListener("change", () => {
			this.setState({ ...this.state, showTrail: trailCheckbox.checked });
		});

		const clusters = this.section("clusters", t("panel.section.clusters"));
		const bubbleRow = clusters.createDiv({ cls: "graph-insight-panel-row" });
		const bubbleLabel = bubbleRow.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const bubbleCheckbox = bubbleLabel.createEl("input", { type: "checkbox" });
		bubbleCheckbox.checked = this.state.showBubbles;
		bubbleLabel.createSpan({ text: t("clusters.bubbles") });
		bubbleCheckbox.addEventListener("change", () => {
			this.setState({ ...this.state, showBubbles: bubbleCheckbox.checked });
		});
		clusters.createDiv({ cls: "graph-insight-panel-hint", text: t("clusters.hint") });

		const physics = this.section("physics", t("panel.section.physics"));
		// Not part of PanelState — applies immediately on change and always
		// shows "Связи" (the default rule) after a rebuild.
		this.channelSelect(
			physics,
			t("physics.layoutRule"),
			"links",
			{
				links: t("physics.rule.links"),
				tags: t("physics.rule.tags"),
				folders: t("physics.rule.folders"),
			},
			(value) => this.callbacks.onLayoutRule((value ?? "links") as LayoutRule),
			false
		);
		this.physicsSlider(physics, t("physics.repel"), 1, 300, 1, this.state.physics.repel, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, repel: value } });
		});
		this.physicsSlider(physics, t("physics.linkDistance"), 5, 300, 5, this.state.physics.linkDistance, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, linkDistance: value } });
		});
		this.physicsSlider(physics, t("physics.centering"), 0, 0.5, 0.005, this.state.physics.centering, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, centering: value } });
		});
		this.physicsSlider(physics, t("physics.linkStrength"), 0.05, 2, 0.05, this.state.physics.linkStrength, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, linkStrength: value } });
		});
		this.physicsSlider(physics, t("physics.velocityDecay"), 0.1, 0.8, 0.05, this.state.physics.velocityDecay, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, velocityDecay: value } });
		});
		this.physicsSlider(physics, t("physics.elasticity"), 0, 1, 0.05, this.state.physics.elasticity, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, elasticity: value } });
		});
		this.checkboxRow(physics, t("physics.freeLayout"), this.state.physics.freeLayout, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, freeLayout: value } });
		});
		this.checkboxRow(physics, t("physics.disabled"), this.state.physics.disabled ?? false, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, disabled: value } });
		});
		const button = physics.createEl("button", { text: t("physics.reheat") });
		button.addEventListener("click", () => this.callbacks.onReheat());
	}

	private checkboxRow(
		parent: HTMLElement,
		label: string,
		value: boolean,
		onChange: (value: boolean) => void
	): void {
		const row = parent.createDiv({ cls: "graph-insight-panel-row" });
		const labelEl = row.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const checkbox = labelEl.createEl("input", { type: "checkbox" });
		checkbox.checked = value;
		labelEl.createSpan({ text: label });
		checkbox.addEventListener("change", () => onChange(checkbox.checked));
	}

	private physicsSlider(
		parent: HTMLElement,
		label: string,
		min: number,
		max: number,
		step: number,
		value: number,
		onChange: (value: number) => void
	): void {
		const row = parent.createDiv({ cls: "graph-insight-panel-row" });
		row.createSpan({ cls: "graph-insight-panel-label", text: label });
		const valueEl = row.createSpan({ cls: "graph-insight-panel-count", text: String(value) });
		const slider = parent.createEl("input", { type: "range" });
		slider.min = String(min);
		slider.max = String(max);
		slider.step = String(step);
		slider.value = String(value);
		slider.addEventListener("input", () => {
			const next = Number(slider.value);
			valueEl.setText(step < 1 ? next.toFixed(3) : String(next));
			onChange(next);
		});
	}

	setHiddenNodeCount(count: number): void {
		this.hiddenCountEl?.setText(String(count));
	}

	setViewPresets(rows: readonly ViewPresetRow[]): void {
		this.viewPresets = [...rows];
		this.renderPresetOptions();
	}

	/** Keep the applied preset shown as selected (and thus deletable) across
	 *  the panel rebuild that follows applying one. */
	setSelectedPreset(index: number | null): void {
		this.selectedPresetIndex = index;
		this.renderPresetOptions();
	}

	private renderPresetOptions(): void {
		if (!this.presetSelect) return;
		this.presetSelect.empty();
		const hasSelection =
			this.selectedPresetIndex !== null &&
			this.selectedPresetIndex >= 0 &&
			this.selectedPresetIndex < this.viewPresets.length;
		const placeholder = this.presetSelect.createEl("option", {
			text: this.viewPresets.length > 0 ? t("presets.choose") : t("presets.empty"),
			value: "",
		});
		placeholder.selected = !hasSelection;
		this.viewPresets.forEach((preset, index) => {
			const option = this.presetSelect!.createEl("option", {
				text: preset.name,
				value: String(index),
			});
			if (hasSelection && index === this.selectedPresetIndex) option.selected = true;
		});
	}

	setOverlayCounts(counts: OverlayCounts): void {
		this.overlayCountEls.get("orphans")?.setText(String(counts.orphans));
		this.overlayCountEls.get("deadEnds")?.setText(String(counts.deadEnds));
		this.overlayCountEls.get("broken")?.setText(String(counts.broken));
	}

	/** Sections are accordions; everything except the first two starts collapsed.
	 *  Keyed by a language-independent id, so switching the app language does not
	 *  reset which sections are open. Static: the set survives panel rebuilds. */
	private static openSections = new Set<string>(["presets", "appearance"]);
	private get openSections(): Set<string> {
		return ControlPanel.openSections;
	}

	private section(id: string, title: string): HTMLElement {
		const section = this.body.createDiv({ cls: "graph-insight-panel-section" });
		const header = section.createDiv({ cls: "graph-insight-panel-section-title" });
		const chevron = header.createSpan({
			text: this.openSections.has(id) ? "▾" : "▸",
			cls: "graph-insight-panel-chevron",
		});
		header.createSpan({ text: title });
		const content = section.createDiv({ cls: "graph-insight-panel-section-body" });
		content.toggleClass("is-hidden", !this.openSections.has(id));
		header.addEventListener("click", () => {
			if (this.openSections.has(id)) this.openSections.delete(id);
			else this.openSections.add(id);
			const open = this.openSections.has(id);
			chevron.setText(open ? "▾" : "▸");
			content.toggleClass("is-hidden", !open);
		});
		return content;
	}

	private channelSelect(
		parent: HTMLElement,
		label: string,
		current: string | null,
		options: Record<string, string>,
		onSelect: (value: string | null) => void,
		allowNone = true
	): void {
		const row = parent.createDiv({ cls: "graph-insight-panel-row" });
		row.createSpan({ cls: "graph-insight-panel-label", text: label });
		const select = row.createEl("select", { cls: "dropdown" });
		if (allowNone) {
			const none = select.createEl("option", { text: "—", value: NONE_VALUE });
			none.selected = current === null;
		}
		for (const [value, text] of Object.entries(options)) {
			const option = select.createEl("option", { text, value });
			option.selected = current === value;
		}
		select.addEventListener("change", () => {
			onSelect(select.value === NONE_VALUE ? null : select.value);
		});
	}

	destroy(): void {
		this.root.remove();
	}
}
