import { Modal, Setting, type App } from "obsidian";
import { t } from "../i18n";

/**
 * Yes/no gate in front of anything that destroys data. The destructive button
 * is the warning-colored one, and closing the dialog any other way counts as a
 * no — nothing runs until the user picks it deliberately.
 */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly message: string,
		private readonly onConfirm: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("confirm.title"));
		this.contentEl.createEl("p", { text: this.message });

		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText(t("confirm.proceed"))
					// Destructive primary action: this modal only ever guards
					// resets and deletions.
					.setDestructive()
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			)
			.addButton((button) => button.setButtonText(t("confirm.cancel")).onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
