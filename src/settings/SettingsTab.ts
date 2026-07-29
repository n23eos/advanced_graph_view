import {
	Notice,
	PluginSettingTab,
	type App,
	type SettingDefinitionItem,
} from "obsidian";
import { emptyLog } from "../data/UsageTracker";
import { usageToCsv } from "../export/exporters";
import { t } from "../i18n";
import type GraphInsightPlugin from "../main";

/** Keys addressed by the declarative settings API. */
type SettingKey =
	| "openDwellSeconds"
	| "hoverPreviewEnabled"
	| "hoverPreviewWords"
	| "hoverPreviewDelay";

/**
 * Declarative settings (Obsidian 1.13+). Describing the settings instead of
 * building DOM makes them searchable from Obsidian's own settings search.
 */
export class GraphInsightSettingsTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: GraphInsightPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				type: "group",
				heading: t("settings.group.tracking"),
				items: [
					{
						name: t("settings.openThreshold"),
						desc: t("settings.openThreshold.desc"),
						aliases: ["usage", "statistics", "dwell"],
						control: {
							type: "slider",
							key: "openDwellSeconds",
							min: 1,
							max: 30,
							step: 1,
							displayFormat: (value) => t("settings.seconds", { value }),
						},
					},
					{
						name: t("settings.exportCsv"),
						desc: t("settings.exportCsv.desc"),
						aliases: ["statistics", "download"],
						action: () => {
							downloadText("graph-insight-usage.csv", usageToCsv(this.plugin.usageLog));
						},
					},
					{
						name: t("settings.clearUsage"),
						desc: t("settings.clearUsage.desc"),
						aliases: ["reset", "statistics"],
						action: () => {
							this.plugin.usageLog = emptyLog();
							void this.plugin.dataStore
								.saveUsage(this.plugin.usageLog)
								.then(() => new Notice(t("notice.usageCleared")));
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settings.group.hover"),
				items: [
					{
						name: t("settings.hoverEnabled"),
						desc: t("settings.hoverEnabled.desc"),
						aliases: ["tooltip", "hover", "preview"],
						control: {
							type: "toggle",
							key: "hoverPreviewEnabled",
						},
					},
					{
						name: t("settings.hoverWords"),
						desc: t("settings.hoverWords.desc"),
						aliases: ["tooltip", "hover", "words"],
						control: {
							type: "number",
							key: "hoverPreviewWords",
							min: 10,
							max: 500,
							step: 10,
							placeholder: "300",
							validate: (value) =>
								value >= 10 && value <= 500
										? undefined
										: t("settings.range", { min: 10, max: 500 }),
						},
					},
					{
						name: t("settings.hoverDelay"),
						desc: t("settings.hoverDelay.desc"),
						aliases: ["tooltip", "hover", "delay"],
						control: {
							type: "number",
							key: "hoverPreviewDelay",
							min: 0,
							max: 2000,
							step: 50,
							placeholder: "350",
							validate: (value) =>
								value >= 0 && value <= 2000
										? undefined
										: t("settings.range", { min: 0, max: 2000 }),
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settings.group.data"),
				items: [
					{
						name: t("settings.resetAll"),
						desc: t("settings.resetAll.desc"),
						aliases: ["clear", "wipe"],
						action: () => void this.resetAllData(),
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		switch (key as SettingKey) {
			case "openDwellSeconds":
				return this.plugin.settings.openDwellSeconds;
			case "hoverPreviewEnabled":
				return this.plugin.settings.hoverPreview.enabled;
			case "hoverPreviewWords":
				return this.plugin.settings.hoverPreview.words;
			case "hoverPreviewDelay":
				return this.plugin.settings.hoverPreview.delayMs;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key as SettingKey) {
			case "openDwellSeconds":
				this.plugin.settings = { ...this.plugin.settings, openDwellSeconds: value as number };
				await this.plugin.saveData(this.plugin.settings);
				return;
			case "hoverPreviewEnabled":
				this.plugin.settings = {
					...this.plugin.settings,
					hoverPreview: { ...this.plugin.settings.hoverPreview, enabled: value as boolean },
				};
				await this.plugin.saveData(this.plugin.settings);
				return;
			case "hoverPreviewWords":
				this.plugin.settings = {
					...this.plugin.settings,
					hoverPreview: { ...this.plugin.settings.hoverPreview, words: value as number },
				};
				await this.plugin.saveData(this.plugin.settings);
				return;
			case "hoverPreviewDelay":
				this.plugin.settings = {
					...this.plugin.settings,
					hoverPreview: { ...this.plugin.settings.hoverPreview, delayMs: value as number },
				};
				await this.plugin.saveData(this.plugin.settings);
				return;
		}
	}

	private async resetAllData(): Promise<void> {
		this.plugin.usageLog = emptyLog();
		await this.plugin.dataStore.saveUsage(this.plugin.usageLog);
		await this.plugin.dataStore.savePositions({ positions: {}, pins: [] });
		new Notice(t("notice.dataReset"));
	}
}

function downloadText(fileName: string, content: string): void {
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const anchor = createEl("a", { attr: { href: url, download: fileName } });
	anchor.click();
	URL.revokeObjectURL(url);
}
