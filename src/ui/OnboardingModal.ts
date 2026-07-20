import { Modal, type App } from "obsidian";

/** Three-step intro shown on the first open of the graph view. */
export class OnboardingModal extends Modal {
	constructor(app: App, private readonly onDismissForever: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Graph Insight — что здесь нового");
		const steps: [string, string][] = [
			[
				"1 · Узлы кодируют метрики",
				"Размер = PageRank (реальная важность), цвет = свежесть правки. Панель слева меняет назначение каналов: открытия, связи, возраст, папки, теги, кластеры.",
			],
			[
				"2 · Слои и фильтры",
				"Слои подсвечивают сирот, тупики и битые ссылки. Поиск сверху понимает path:, tag:, opened:>10, edited:<30d. Даблклик по узлу — focus-режим, Shift+drag — lasso.",
			],
			[
				"3 · Семантические рёбра",
				"Включи семантику в панели — пунктирные рёбра покажут заметки, которые похожи по смыслу, но НЕ связаны ссылкой. Клик по ребру — создать ссылку в один клик.",
			],
		];
		for (const [title, body] of steps) {
			this.contentEl.createEl("h5", { text: title });
			this.contentEl.createEl("p", { text: body });
		}
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const done = buttons.createEl("button", { text: "Понятно, не показывать", cls: "mod-cta" });
		done.addEventListener("click", () => {
			this.onDismissForever();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
