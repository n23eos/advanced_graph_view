/**
 * Runtime stand-in for the "obsidian" package in vitest: the real package
 * ships types only, so any module importing it needs this stub to load under
 * jsdom. Wired up via the `test.alias` entry in vitest.config.ts. Only what
 * the components under test actually touch — grow it as tests need more.
 */

export function setIcon(): void {}

export class Notice {
	constructor(public message?: string) {}
}

export class Modal {
	app: unknown;
	contentEl: HTMLElement = document.createElement("div");
	titleEl: HTMLElement = document.createElement("div");
	constructor(app?: unknown) {
		this.app = app;
	}
	open(): void {
		// Attach so tests can reach the modal's buttons through the document.
		document.body.appendChild(this.contentEl);
		this.onOpen();
	}
	close(): void {
		this.onClose();
		this.contentEl.remove();
	}
	onOpen(): void {}
	onClose(): void {}
}

class ButtonStub {
	buttonEl: HTMLButtonElement = document.createElement("button");
	setButtonText(text: string): this {
		this.buttonEl.textContent = text;
		return this;
	}
	setDestructive(): this {
		return this;
	}
	setCta(): this {
		return this;
	}
	onClick(handler: () => void): this {
		this.buttonEl.addEventListener("click", handler);
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement = document.createElement("div");
	constructor(container: HTMLElement) {
		container.appendChild(this.settingEl);
	}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	addButton(configure: (button: ButtonStub) => unknown): this {
		const button = new ButtonStub();
		this.settingEl.appendChild(button.buttonEl);
		configure(button);
		return this;
	}
}
