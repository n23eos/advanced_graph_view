import { Modal, type App } from "obsidian";
import { t } from "../i18n";

export interface TopicMapExportDraft {
	name: string;
	folder: string;
	depth: number;
	includeDirections: boolean;
	includeMetrics: boolean;
	includeInternalLinks: boolean;
}

/** F-12: options gate in front of the topic-map export. Nothing is written
 *  until the user confirms here; cancel creates no file. */
export class TopicMapExportModal extends Modal {
	private nameInput!: HTMLInputElement;
	private folderInput!: HTMLInputElement;
	private depthInput: HTMLInputElement | null = null;
	private checks = new Map<keyof TopicMapExportDraft, HTMLInputElement>();
	private errorEl!: HTMLElement;

	constructor(
		app: App,
		private readonly initial: TopicMapExportDraft,
		/** Rooted sources pick a BFS depth; lasso/cluster have none. */
		private readonly showDepth: boolean,
		private readonly onSubmit: (draft: TopicMapExportDraft) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("topicmap.modalTitle"));
		this.nameInput = this.labeledInput(t("topicmap.noteName"), this.initial.name);
		this.folderInput = this.labeledInput(t("topicmap.folder"), this.initial.folder);

		if (this.showDepth) {
			const row = this.contentEl.createDiv({ cls: "graph-insight-preset-row" });
			row.createSpan({ cls: "graph-insight-preset-label", text: t("topicmap.depth") });
			this.depthInput = row.createEl("input", { type: "range" });
			this.depthInput.min = "1";
			this.depthInput.max = "4";
			this.depthInput.value = String(this.initial.depth);
			const value = row.createSpan({ text: String(this.initial.depth) });
			this.depthInput.addEventListener("input", () => value.setText(this.depthInput!.value));
		}

		this.checkbox("includeDirections", t("topicmap.optDirections"), this.initial.includeDirections);
		this.checkbox("includeMetrics", t("topicmap.optMetrics"), this.initial.includeMetrics);
		this.checkbox("includeInternalLinks", t("topicmap.optInternal"), this.initial.includeInternalLinks);

		this.errorEl = this.contentEl.createDiv({ cls: "graph-insight-preset-error" });
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const submit = buttons.createEl("button", { text: t("topicmap.export"), cls: "mod-cta" });
		submit.addEventListener("click", () => this.submit());
		const cancel = buttons.createEl("button", { text: t("preset.cancel") });
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private labeledInput(label: string, value: string): HTMLInputElement {
		const row = this.contentEl.createDiv({ cls: "graph-insight-preset-row" });
		row.createSpan({ cls: "graph-insight-preset-label", text: label });
		const input = row.createEl("input", { type: "text", value });
		input.setAttribute("aria-label", label);
		return input;
	}

	private checkbox(key: keyof TopicMapExportDraft, label: string, value: boolean): void {
		const row = this.contentEl.createDiv({ cls: "graph-insight-preset-row" });
		const input = row.createEl("input", { type: "checkbox" });
		input.checked = value;
		input.setAttribute("aria-label", label);
		row.createSpan({ text: label });
		this.checks.set(key, input);
	}

	private submit(): void {
		const name = this.nameInput.value.trim();
		if (!name) {
			this.errorEl.setText(t("preset.nameRequired"));
			return;
		}
		this.onSubmit({
			name,
			folder: this.folderInput.value.trim(),
			depth: this.depthInput ? Number(this.depthInput.value) : this.initial.depth,
			includeDirections: this.checks.get("includeDirections")!.checked,
			includeMetrics: this.checks.get("includeMetrics")!.checked,
			includeInternalLinks: this.checks.get("includeInternalLinks")!.checked,
		});
		this.close();
	}
}

export type ExportConflictChoice = "overwrite" | "copy" | "cancel";

/** Name collision gate: Copy is the safe default, Overwrite is explicit,
 *  and closing any other way counts as Cancel (F-12). */
export class ExportConflictModal extends Modal {
	private choice: ExportConflictChoice = "cancel";
	private reported = false;

	constructor(
		app: App,
		private readonly fileName: string,
		private readonly onChoice: (choice: ExportConflictChoice) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("topicmap.modalTitle"));
		this.contentEl.createEl("p", { text: t("topicmap.conflict", { name: this.fileName }) });
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const copy = buttons.createEl("button", { text: t("topicmap.copy"), cls: "mod-cta" });
		copy.addEventListener("click", () => this.finish("copy"));
		const overwrite = buttons.createEl("button", { text: t("topicmap.overwrite"), cls: "mod-warning" });
		overwrite.addEventListener("click", () => this.finish("overwrite"));
		const cancel = buttons.createEl("button", { text: t("preset.cancel") });
		cancel.addEventListener("click", () => this.finish("cancel"));
	}

	onClose(): void {
		this.report();
		this.contentEl.empty();
	}

	private finish(choice: ExportConflictChoice): void {
		this.choice = choice;
		this.close();
		this.report();
	}

	private report(): void {
		if (this.reported) return;
		this.reported = true;
		this.onChoice(this.choice);
	}
}
