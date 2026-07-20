/**
 * Bottom timeline: month slider with an activity sparkline, play button
 * (growth animation), created/modified mode switch.
 */
import {
	buildMonthHistogram,
	monthIndexLabel,
	monthIndexToCutoff,
	type MonthHistogram,
} from "../analysis/timeline";

export type TimelineMode = "created" | "modified";

export interface TimelineCallbacks {
	/** null = show everything (slider at the end). */
	onCutoffChange(cutoff: number | null): void;
	onModeChange(mode: TimelineMode): void;
}

const PLAY_MONTHS_PER_SECOND = 1;

export class TimelineBar {
	private root: HTMLElement;
	private slider: HTMLInputElement;
	private labelEl: HTMLElement;
	private playButton: HTMLButtonElement;
	private sparklineCanvas: HTMLCanvasElement;
	private histogram: MonthHistogram = { counts: [], startYear: 0, startMonth: 0 };
	private playTimer: number | null = null;
	private mode: TimelineMode = "created";

	constructor(host: HTMLElement, private readonly callbacks: TimelineCallbacks) {
		this.root = host.createDiv({ cls: "graph-insight-timeline" });

		this.playButton = this.root.createEl("button", { text: "⏵" });
		this.playButton.addEventListener("click", () => this.togglePlay());

		const sliderWrap = this.root.createDiv({ cls: "graph-insight-timeline-slider" });
		this.sparklineCanvas = sliderWrap.createEl("canvas", { cls: "graph-insight-timeline-spark" });
		this.slider = sliderWrap.createEl("input", { type: "range" });
		this.slider.min = "0";
		this.slider.addEventListener("input", () => {
			this.stopPlay();
			this.emitCutoff();
		});

		this.labelEl = this.root.createSpan({ cls: "graph-insight-timeline-label" });

		const modeSelect = this.root.createEl("select", { cls: "dropdown" });
		modeSelect.createEl("option", { text: "Создание", value: "created" });
		modeSelect.createEl("option", { text: "Изменение", value: "modified" });
		modeSelect.addEventListener("change", () => {
			this.mode = modeSelect.value as TimelineMode;
			this.callbacks.onModeChange(this.mode);
		});

		this.hide();
	}

	setTimestamps(timestamps: number[]): void {
		this.histogram = buildMonthHistogram(timestamps);
		const lastIndex = Math.max(0, this.histogram.counts.length - 1);
		this.slider.max = String(lastIndex);
		this.slider.value = String(lastIndex);
		this.drawSparkline();
		this.updateLabel();
	}

	show(): void {
		this.root.show();
	}

	hide(): void {
		this.stopPlay();
		this.root.hide();
		this.callbacks.onCutoffChange(null);
	}

	private currentIndex(): number {
		return Number(this.slider.value);
	}

	private emitCutoff(): void {
		this.updateLabel();
		const lastIndex = this.histogram.counts.length - 1;
		const index = this.currentIndex();
		this.callbacks.onCutoffChange(
			index >= lastIndex ? null : monthIndexToCutoff(this.histogram, index)
		);
	}

	private updateLabel(): void {
		if (this.histogram.counts.length === 0) {
			this.labelEl.setText("");
			return;
		}
		this.labelEl.setText(monthIndexLabel(this.histogram, this.currentIndex()));
	}

	private togglePlay(): void {
		if (this.playTimer !== null) {
			this.stopPlay();
			return;
		}
		if (this.currentIndex() >= this.histogram.counts.length - 1) this.slider.value = "0";
		this.playButton.setText("⏸");
		this.playTimer = window.setInterval(() => {
			const next = this.currentIndex() + 1;
			if (next >= this.histogram.counts.length) {
				this.stopPlay();
				return;
			}
			this.slider.value = String(next);
			this.emitCutoff();
		}, 1000 / PLAY_MONTHS_PER_SECOND);
	}

	private stopPlay(): void {
		if (this.playTimer !== null) {
			window.clearInterval(this.playTimer);
			this.playTimer = null;
		}
		this.playButton.setText("⏵");
	}

	private drawSparkline(): void {
		const canvas = this.sparklineCanvas;
		const width = (canvas.width = 260);
		const height = (canvas.height = 22);
		const context = canvas.getContext("2d");
		if (!context) return;
		context.clearRect(0, 0, width, height);
		const counts = this.histogram.counts;
		if (counts.length === 0) return;
		const max = Math.max(...counts, 1);
		const barWidth = width / counts.length;
		const accent = getComputedStyle(document.body).getPropertyValue("--interactive-accent").trim() || "#7c3aed";
		context.fillStyle = accent;
		context.globalAlpha = 0.55;
		for (let i = 0; i < counts.length; i++) {
			const barHeight = (counts[i] / max) * height;
			context.fillRect(i * barWidth, height - barHeight, Math.max(barWidth - 1, 1), barHeight);
		}
	}

	destroy(): void {
		this.stopPlay();
		this.root.remove();
	}
}
