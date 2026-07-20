import { Modal, Setting, type App } from "obsidian";

/** Small text-input modal — replaces window.prompt, which Obsidian forbids. */
export class PromptModal extends Modal {
	private value: string;

	constructor(
		app: App,
		private readonly title: string,
		initialValue: string,
		private readonly onSubmit: (value: string) => void
	) {
		super(app);
		this.value = initialValue;
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		const input = new Setting(this.contentEl).addText((text) =>
			text.setValue(this.value).onChange((value) => {
				this.value = value;
			})
		);
		input.settingEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key === "Enter") this.submit();
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Сохранить").setCta().onClick(() => this.submit())
			)
			.addButton((button) => button.setButtonText("Отмена").onClick(() => this.close()));
	}

	private submit(): void {
		const trimmed = this.value.trim();
		if (!trimmed) return;
		this.close();
		this.onSubmit(trimmed);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
