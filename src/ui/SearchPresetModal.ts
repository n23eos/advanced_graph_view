import { Modal, type App } from "obsidian";
import { t } from "../i18n";
import { validateQuery } from "../query/QueryParser";
import { validatePresetName } from "../settings/searchPresets";
import { queryErrorText } from "./queryErrors";

export interface SearchPresetDraft {
	name: string;
	query: string;
}

/**
 * Name + Query form for saving or editing a search filter (F-09). Nothing is
 * submitted until the name fits 1–80 characters and the query passes the
 * parser's validation; the error line says which rule failed.
 */
export class SearchPresetModal extends Modal {
	private nameInput!: HTMLInputElement;
	private queryInput!: HTMLInputElement;
	private errorEl!: HTMLElement;

	constructor(
		app: App,
		private readonly title: string,
		private readonly initial: SearchPresetDraft,
		private readonly onSubmit: (draft: SearchPresetDraft) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.title);

		this.nameInput = this.labeledInput(t("preset.name"), this.initial.name);
		this.queryInput = this.labeledInput(t("preset.query"), this.initial.query);
		this.errorEl = this.contentEl.createDiv({ cls: "graph-insight-preset-error" });

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const save = buttons.createEl("button", { text: t("preset.save"), cls: "mod-cta" });
		save.addEventListener("click", () => this.submit());
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

	private submit(): void {
		const name = validatePresetName(this.nameInput.value);
		if (name === null) {
			this.errorEl.setText(t("preset.nameRequired"));
			return;
		}
		const query = this.queryInput.value.trim();
		const diagnostic = validateQuery(query);
		if (diagnostic) {
			this.errorEl.setText(queryErrorText(diagnostic));
			return;
		}
		this.onSubmit({ name, query });
		this.close();
	}
}
