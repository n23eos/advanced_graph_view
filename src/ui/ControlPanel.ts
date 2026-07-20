/**
 * Floating control panel: metric-to-channel assignment, overlay toggles,
 * cluster list. Native DOM + Obsidian CSS variables, no framework.
 */
import type { ChannelAssignment } from "../encoding/encode";
import {
	CATEGORICAL_METRIC_LABELS,
	NUMERIC_METRIC_LABELS,
	type MetricId,
	type NumericMetricId,
} from "../encoding/metrics";
import { SCALE_PRESETS } from "../encoding/colorScales";
import type { OverlayCounts, OverlayToggles } from "../analysis/overlays";
import type { SemanticSettings } from "../main";
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
	colorTuning: ColorTuningState;
}

export interface ColorTuningState {
	preset: string;
	useCustom: boolean;
	customFrom: string;
	customTo: string;
	gamma: number;
}

export interface View3DOptions {
	enabled: boolean;
	depthSource: "physics" | "cluster" | "age";
	/** Camera focal length: lower = stronger perspective. */
	focal: number;
}

export interface LabelOptions {
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

export interface PanelCallbacks {
	onChange(state: PanelState): void;
	onReheat(): void;
	onClusterClick(index: number): void;
	onClusterToggle(index: number): void;
	onSemanticChange(settings: SemanticSettings): void;
	onTrailReplay(): void;
	onShowHiddenNodes(): void;
}

const NONE_VALUE = "__none__";
const OVERLAY_LABELS: Record<keyof OverlayToggles, string> = {
	orphans: "Сироты",
	deadEnds: "Тупики",
	broken: "Битые ссылки",
};

export class ControlPanel {
	private root: HTMLElement;
	private body: HTMLElement;
	private overlayCountEls = new Map<keyof OverlayToggles, HTMLElement>();
	private semanticStatusEl: HTMLElement | null = null;
	private hiddenCountEl: HTMLElement | null = null;

	constructor(
		host: HTMLElement,
		private state: PanelState,
		private semantic: SemanticSettings,
		private readonly callbacks: PanelCallbacks
	) {
		this.root = host.createDiv({ cls: "graph-insight-panel" });

		const header = this.root.createDiv({ cls: "graph-insight-panel-header" });
		header.createSpan({ text: "Graph Insight" });
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

		const view = this.section("Вид");
		this.channelSelect(view, "Размер", this.state.channels.size, NUMERIC_METRIC_LABELS, (value) => {
			this.setState({ ...this.state, channels: { ...this.state.channels, size: value as NumericMetricId | null } });
		});
		this.channelSelect(
			view,
			"Цвет",
			this.state.channels.color,
			{ ...NUMERIC_METRIC_LABELS, ...CATEGORICAL_METRIC_LABELS },
			(value) => {
				this.setState({ ...this.state, channels: { ...this.state.channels, color: value as MetricId | null } });
			}
		);
		this.channelSelect(view, "Свечение", this.state.channels.glow, NUMERIC_METRIC_LABELS, (value) => {
			this.setState({ ...this.state, channels: { ...this.state.channels, glow: value as NumericMetricId | null } });
		});

		const presetLabels: Record<string, string> = {};
		for (const [id, preset] of Object.entries(SCALE_PRESETS)) presetLabels[id] = preset.label;
		this.channelSelect(view, "Шкала", this.state.colorPreset, presetLabels, (value) => {
			this.setState({ ...this.state, colorPreset: value ?? "recency" });
		}, false);

		this.physicsSlider(view, "Размер узлов", 0.1, 2.5, 0.05, this.state.nodeScale, (value) => {
			this.setState({ ...this.state, nodeScale: value });
		});

		const textSection = this.section("Текст");
		this.physicsSlider(textSection, "Размер подписей", 6, 18, 0.5, this.state.labels.fontSize, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, fontSize: value } });
		});
		this.physicsSlider(textSection, "Подписи при зуме от", 0.1, 2, 0.01, this.state.labels.zoomThreshold, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, zoomThreshold: value } });
		});
		this.physicsSlider(textSection, "Макс. подписей", 5, 400, 5, this.state.labels.maxCount, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, maxCount: value } });
		});
		this.checkboxRow(textSection, "Текст мельчает с зумом", this.state.labels.scaleWithZoom, (value) => {
			this.setState({ ...this.state, labels: { ...this.state.labels, scaleWithZoom: value } });
		});

		const edgeSection = this.section("Связи");
		this.checkboxRow(edgeSection, "Показывать связи", this.state.edges.show, (value) => {
			this.setState({ ...this.state, edges: { ...this.state.edges, show: value } });
		});
		this.physicsSlider(edgeSection, "Толщина", 0.3, 8, 0.1, this.state.edges.width, (value) => {
			this.setState({ ...this.state, edges: { ...this.state.edges, width: value } });
		});
		this.physicsSlider(edgeSection, "Прозрачность", 0.05, 1, 0.05, this.state.edges.opacity, (value) => {
			this.setState({ ...this.state, edges: { ...this.state.edges, opacity: value } });
		});

		const threeD = this.section("3D");
		this.checkboxRow(threeD, "Объёмный режим", this.state.view3d.enabled, (value) => {
			this.setState({ ...this.state, view3d: { ...this.state.view3d, enabled: value } });
		});
		this.channelSelect(
			threeD,
			"Глубина",
			this.state.view3d.depthSource,
			{ physics: "Физика (сфера)", cluster: "Кластер (этажи)", age: "Возраст" },
			(value) => {
				this.setState({
					...this.state,
					view3d: { ...this.state.view3d, depthSource: (value ?? "physics") as View3DOptions["depthSource"] },
				});
			},
			false
		);
		this.physicsSlider(threeD, "Перспектива", 300, 2500, 50, this.state.view3d.focal, (value) => {
			this.setState({ ...this.state, view3d: { ...this.state.view3d, focal: value } });
		});
		threeD.createDiv({
			cls: "graph-insight-panel-hint",
			text: "Вращение: тянуть пустое место. Alt+drag — пан.",
		});

		const layers = this.section("Слои");
		for (const key of Object.keys(OVERLAY_LABELS) as (keyof OverlayToggles)[]) {
			const row = layers.createDiv({ cls: "graph-insight-panel-row" });
			const label = row.createEl("label", { cls: "graph-insight-panel-checkbox" });
			const checkbox = label.createEl("input", { type: "checkbox" });
			checkbox.checked = this.state.overlays[key];
			label.createSpan({ text: OVERLAY_LABELS[key] });
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
		hiddenRow.createSpan({ cls: "graph-insight-panel-label", text: "Скрытые узлы" });
		this.hiddenCountEl = hiddenRow.createSpan({ cls: "graph-insight-panel-count", text: "0" });
		const showHidden = hiddenRow.createEl("button", { text: "Показать", cls: "graph-insight-searchbar-btn" });
		showHidden.addEventListener("click", () => this.callbacks.onShowHiddenNodes());

		const timelineRow = layers.createDiv({ cls: "graph-insight-panel-row" });
		const timelineLabel = timelineRow.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const timelineCheckbox = timelineLabel.createEl("input", { type: "checkbox" });
		timelineCheckbox.checked = this.state.showTimeline;
		timelineLabel.createSpan({ text: "Таймлайн" });
		timelineCheckbox.addEventListener("change", () => {
			this.setState({ ...this.state, showTimeline: timelineCheckbox.checked });
		});

		const trailRow = layers.createDiv({ cls: "graph-insight-panel-row" });
		const trailLabel = trailRow.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const trailCheckbox = trailLabel.createEl("input", { type: "checkbox" });
		trailCheckbox.checked = this.state.showTrail;
		trailLabel.createSpan({ text: "Трейл сессии" });
		const replay = trailRow.createEl("button", { text: "⟲", cls: "graph-insight-searchbar-btn" });
		replay.setAttribute("aria-label", "Проиграть трейл заново");
		replay.addEventListener("click", () => this.callbacks.onTrailReplay());
		trailCheckbox.addEventListener("change", () => {
			this.setState({ ...this.state, showTrail: trailCheckbox.checked });
		});

		const clusters = this.section("Кластеры");
		const bubbleRow = clusters.createDiv({ cls: "graph-insight-panel-row" });
		const bubbleLabel = bubbleRow.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const bubbleCheckbox = bubbleLabel.createEl("input", { type: "checkbox" });
		bubbleCheckbox.checked = this.state.showBubbles;
		bubbleLabel.createSpan({ text: "Пузыри кластеров" });
		bubbleCheckbox.addEventListener("change", () => {
			this.setState({ ...this.state, showBubbles: bubbleCheckbox.checked });
		});
		clusters.createDiv({ cls: "graph-insight-panel-hint", text: "Список кластеров — панель справа" });

		const semanticSection = this.section("Семантика");
		const enableRow = semanticSection.createDiv({ cls: "graph-insight-panel-row" });
		const enableLabel = enableRow.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const enableCheckbox = enableLabel.createEl("input", { type: "checkbox" });
		enableCheckbox.checked = this.semantic.enabled;
		enableLabel.createSpan({ text: "Включить" });
		enableCheckbox.addEventListener("change", () => {
			this.semantic = { ...this.semantic, enabled: enableCheckbox.checked };
			this.callbacks.onSemanticChange(this.semantic);
		});

		const edgesRow = semanticSection.createDiv({ cls: "graph-insight-panel-row" });
		const edgesLabel = edgesRow.createEl("label", { cls: "graph-insight-panel-checkbox" });
		const edgesCheckbox = edgesLabel.createEl("input", { type: "checkbox" });
		edgesCheckbox.checked = this.semantic.showEdges;
		edgesLabel.createSpan({ text: "Семантические рёбра" });
		edgesCheckbox.addEventListener("change", () => {
			this.semantic = { ...this.semantic, showEdges: edgesCheckbox.checked };
			this.callbacks.onSemanticChange(this.semantic);
		});

		const thresholdRow = semanticSection.createDiv({ cls: "graph-insight-panel-row" });
		thresholdRow.createSpan({ cls: "graph-insight-panel-label", text: "Порог" });
		const thresholdValue = thresholdRow.createSpan({
			cls: "graph-insight-panel-count",
			text: this.semantic.threshold.toFixed(2),
		});
		const thresholdSlider = semanticSection.createEl("input", { type: "range" });
		thresholdSlider.min = "0.5";
		thresholdSlider.max = "0.95";
		thresholdSlider.step = "0.01";
		thresholdSlider.value = String(this.semantic.threshold);
		thresholdSlider.addEventListener("input", () => {
			this.semantic = { ...this.semantic, threshold: Number(thresholdSlider.value) };
			thresholdValue.setText(this.semantic.threshold.toFixed(2));
			this.callbacks.onSemanticChange(this.semantic);
		});
		this.semanticStatusEl = semanticSection.createDiv({
			cls: "graph-insight-panel-hint",
			text: "",
		});

		const physics = this.section("Физика");
		this.physicsSlider(physics, "Разлёт узлов (отталкивание)", 1, 300, 1, this.state.physics.repel, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, repel: value } });
		});
		this.physicsSlider(physics, "Длина связей", 5, 300, 5, this.state.physics.linkDistance, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, linkDistance: value } });
		});
		this.physicsSlider(physics, "Притяжение к центру", 0, 0.5, 0.005, this.state.physics.centering, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, centering: value } });
		});
		this.physicsSlider(physics, "Сила связей", 0.05, 2, 0.05, this.state.physics.linkStrength, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, linkStrength: value } });
		});
		this.physicsSlider(physics, "Плавность", 0.1, 0.8, 0.05, this.state.physics.velocityDecay, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, velocityDecay: value } });
		});
		this.checkboxRow(physics, "Свободная раскладка", this.state.physics.freeLayout, (value) => {
			this.setState({ ...this.state, physics: { ...this.state.physics, freeLayout: value } });
		});
		const button = physics.createEl("button", { text: "Перезапустить симуляцию" });
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

	setSemanticStatus(text: string): void {
		this.semanticStatusEl?.setText(text);
	}

	setOverlayCounts(counts: OverlayCounts): void {
		this.overlayCountEls.get("orphans")?.setText(String(counts.orphans));
		this.overlayCountEls.get("deadEnds")?.setText(String(counts.deadEnds));
		this.overlayCountEls.get("broken")?.setText(String(counts.broken));
	}

	/** Sections are accordions; everything except «Вид» starts collapsed.
	 *  Static: the set survives panel rebuilds (updatePanelState). */
	private static openSections = new Set<string>(["Вид"]);
	private get openSections(): Set<string> {
		return ControlPanel.openSections;
	}

	private section(title: string): HTMLElement {
		const section = this.body.createDiv({ cls: "graph-insight-panel-section" });
		const header = section.createDiv({ cls: "graph-insight-panel-section-title" });
		const chevron = header.createSpan({
			text: this.openSections.has(title) ? "▾" : "▸",
			cls: "graph-insight-panel-chevron",
		});
		header.createSpan({ text: title });
		const content = section.createDiv({ cls: "graph-insight-panel-section-body" });
		content.toggleClass("is-hidden", !this.openSections.has(title));
		header.addEventListener("click", () => {
			if (this.openSections.has(title)) this.openSections.delete(title);
			else this.openSections.add(title);
			const open = this.openSections.has(title);
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
