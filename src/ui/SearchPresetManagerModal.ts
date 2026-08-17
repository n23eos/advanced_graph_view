import { Modal, type App } from "obsidian";
import { t } from "../i18n";
import type { SearchPreset } from "../settings/schema";
import { ConfirmModal } from "./ConfirmModal";
import { SearchPresetModal } from "./SearchPresetModal";

/** The host persists a change and returns the fresh, sorted list to render. */
export interface SearchPresetManagerCallbacks {
	onApply(preset: SearchPreset): void;
	onUpdate(next: SearchPreset): Promise<SearchPreset[]>;
	onDuplicate(preset: SearchPreset): Promise<SearchPreset[]>;
	onDelete(preset: SearchPreset): Promise<SearchPreset[]>;
}

/**
 * List of saved search filters with Apply / Edit / Duplicate / Delete (F-09).
 * Deletion is guarded by a ConfirmModal that names the preset, so removing
 * one of two same-named presets is unambiguous — rows act by id.
 */
export class SearchPresetManagerModal extends Modal {
	constructor(
		app: App,
		private presets: SearchPreset[],
		private readonly callbacks: SearchPresetManagerCallbacks
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("preset.manage"));
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private rerender(next: SearchPreset[]): void {
		this.presets = next;
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		for (const preset of this.presets) {
			const row = this.contentEl.createDiv({ cls: "graph-insight-preset-manager-row" });
			const text = row.createDiv({ cls: "graph-insight-preset-manager-text" });
			text.createDiv({ text: preset.name });
			text.createDiv({ cls: "graph-insight-preset-manager-query", text: preset.query });

			const actions = row.createDiv({ cls: "graph-insight-preset-manager-actions" });
			const apply = actions.createEl("button", { text: t("preset.apply"), cls: "mod-cta" });
			apply.addEventListener("click", () => {
				this.callbacks.onApply(preset);
				this.close();
			});
			const edit = actions.createEl("button", { text: t("preset.edit") });
			edit.addEventListener("click", () => {
				new SearchPresetModal(
					this.app,
					t("preset.modal.editTitle"),
					{ name: preset.name, query: preset.query },
					(draft) => {
						void this.callbacks
							.onUpdate({ ...preset, name: draft.name, query: draft.query, updatedAt: Date.now() })
							.then((next) => this.rerender(next));
					}
				).open();
			});
			const duplicate = actions.createEl("button", { text: t("preset.duplicate") });
			duplicate.addEventListener("click", () => {
				void this.callbacks.onDuplicate(preset).then((next) => this.rerender(next));
			});
			const remove = actions.createEl("button", { text: t("preset.delete") });
			remove.addEventListener("click", () => {
				new ConfirmModal(this.app, t("preset.deleteConfirm", { name: preset.name }), () => {
					void this.callbacks.onDelete(preset).then((next) => this.rerender(next));
				}).open();
			});
		}
	}
}
