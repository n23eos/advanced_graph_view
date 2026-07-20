import { Modal, type App } from "obsidian";

/** One-time consent before downloading the embedding model (~25 MB). */
export class SemanticConsentModal extends Modal {
	constructor(app: App, private readonly onAccept: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Включить семантику?");
		this.contentEl.createEl("p", {
			text:
				"Будет однократно скачана модель эмбеддингов all-MiniLM-L6-v2 (~25 МБ) " +
				"с huggingface.co. После загрузки всё работает полностью офлайн, " +
				"текст заметок никуда не отправляется.",
		});
		this.contentEl.createEl("p", {
			text: "Затем начнётся индексация вайба — прогресс виден в панели.",
		});
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const accept = buttons.createEl("button", { text: "Скачать и включить", cls: "mod-cta" });
		accept.addEventListener("click", () => {
			this.close();
			this.onAccept();
		});
		const cancel = buttons.createEl("button", { text: "Отмена" });
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
