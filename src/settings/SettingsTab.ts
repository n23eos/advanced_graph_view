import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { emptyLog } from "../data/UsageTracker";
import { usageToCsv } from "../export/exporters";
import { SemanticConsentModal } from "../ui/ConsentModal";
import type GraphInsightPlugin from "../main";

export class GraphInsightSettingsTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: GraphInsightPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Отслеживание").setHeading();

		new Setting(containerEl)
			.setName("Порог засчитывания открытия")
			.setDesc("Секунды, которые заметка должна оставаться активной, чтобы открытие попало в статистику.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 30, 1)
					.setValue(this.plugin.settings.openDwellSeconds)
					.onChange(async (value) => {
						this.plugin.settings = { ...this.plugin.settings, openDwellSeconds: value };
						await this.plugin.saveData(this.plugin.settings);
					})
			);

		new Setting(containerEl)
			.setName("Экспорт статистики в CSV")
			.addButton((button) =>
				button.setButtonText("Экспорт").onClick(() => {
					downloadText("graph-insight-usage.csv", usageToCsv(this.plugin.usageLog));
				})
			);

		new Setting(containerEl)
			.setName("Очистить статистику открытий")
			.setDesc("Удаляет весь лог открытий безвозвратно.")
			.addButton((button) =>
				button
					.setButtonText("Очистить")
					.setDestructive()
					.onClick(async () => {
						this.plugin.usageLog = emptyLog();
						await this.plugin.dataStore.saveUsage(this.plugin.usageLog);
						new Notice("Статистика очищена");
					})
			);

		new Setting(containerEl).setName("Семантика").setHeading();

		new Setting(containerEl)
			.setName("Семантический индекс")
			.setDesc("Модель all-MiniLM-L6-v2 (~25 МБ), скачивается однократно, работает офлайн.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.semantics.enabled).onChange((value) => {
					if (value && !this.plugin.settings.semantics.enabled && !this.plugin.settings.semantics.consentGiven) {
						new SemanticConsentModal(this.app, () => {
							void this.plugin.saveSemanticSettings({
								...this.plugin.settings.semantics,
								enabled: true,
								consentGiven: true,
							});
							void this.plugin.semantics.enable();
						}).open();
						toggle.setValue(false);
						return;
					}
					if (value) void this.plugin.semantics.enable();
					void this.plugin.saveSemanticSettings({ ...this.plugin.settings.semantics, enabled: value });
					if (!value) this.plugin.semantics.disable();
				})
			);

		new Setting(containerEl)
			.setName("Порог близости по умолчанию")
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 0.95, 0.01)
					.setValue(this.plugin.settings.semantics.threshold)
					.onChange((value) => {
						void this.plugin.saveSemanticSettings({ ...this.plugin.settings.semantics, threshold: value });
					})
			);

		new Setting(containerEl).setName("Данные").setHeading();

		new Setting(containerEl)
			.setName("Полный сброс данных плагина")
			.setDesc("Статистика, позиции узлов, семантический индекс. Настройки останутся.")
			.addButton((button) =>
				button
					.setButtonText("Сбросить всё")
					.setDestructive()
					.onClick(async () => {
						this.plugin.usageLog = emptyLog();
						await this.plugin.dataStore.saveUsage(this.plugin.usageLog);
						await this.plugin.dataStore.savePositions({});
						await this.plugin.dataStore.writeJsonFile("embeddings-index.json", { dim: 384, paths: [], hashes: [] });
						await this.plugin.dataStore.writeBinaryFile("embeddings.bin", new ArrayBuffer(0));
						new Notice("Данные Graph Insight сброшены");
					})
			);
	}
}

function downloadText(fileName: string, content: string): void {
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const anchor = createEl("a", { attr: { href: url, download: fileName } });
	anchor.click();
	URL.revokeObjectURL(url);
}
