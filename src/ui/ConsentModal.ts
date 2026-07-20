import { Modal, type App } from "obsidian";

/** One-time consent before downloading the embedding model (~25 MB). */
export class SemanticConsentModal extends Modal {
	constructor(app: App, private readonly onAccept: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Enable semantics?");
		this.contentEl.createEl("p", {
			text:
				"The all-MiniLM-L6-v2 embedding model (~25 MB) will be downloaded once " +
				"from huggingface.co. After that everything runs fully offline — your " +
				"note text is never sent anywhere.",
		});
		this.contentEl.createEl("p", {
			text: "Indexing starts right after; progress is shown in the panel.",
		});
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const accept = buttons.createEl("button", { text: "Download and enable", cls: "mod-cta" });
		accept.addEventListener("click", () => {
			this.close();
			this.onAccept();
		});
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
