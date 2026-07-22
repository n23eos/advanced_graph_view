import {
	Notice,
	PluginSettingTab,
	type App,
	type SettingDefinitionItem,
} from "obsidian";
import { emptyLog } from "../data/UsageTracker";
import { usageToCsv } from "../export/exporters";
import type GraphInsightPlugin from "../main";

/** Keys addressed by the declarative settings API. */
type SettingKey = "openDwellSeconds" | "hoverPreviewEnabled" | "hoverPreviewWords";

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
				heading: "Tracking",
				items: [
					{
						name: "Open threshold",
						desc: "How many seconds a note must stay active before the open is counted.",
						aliases: ["usage", "statistics", "dwell"],
						control: {
							type: "slider",
							key: "openDwellSeconds",
							min: 1,
							max: 30,
							step: 1,
							displayFormat: (value) => `${value} s`,
						},
					},
					{
						name: "Export usage as CSV",
						desc: "Download the open-count log as a spreadsheet-friendly file.",
						aliases: ["statistics", "download"],
						action: () => {
							downloadText("graph-insight-usage.csv", usageToCsv(this.plugin.usageLog));
						},
					},
					{
						name: "Clear usage statistics",
						desc: "Permanently deletes the entire open-count log.",
						aliases: ["reset", "statistics"],
						action: () => {
							this.plugin.usageLog = emptyLog();
							void this.plugin.dataStore
								.saveUsage(this.plugin.usageLog)
								.then(() => new Notice("Usage statistics cleared"));
						},
					},
				],
			},
			{
				type: "group",
				heading: "Hover preview",
				items: [
					{
						name: "Show note preview on hover",
						desc: "When hovering a node, show the first words of the note in the tooltip.",
						aliases: ["tooltip", "hover", "preview"],
						control: {
							type: "toggle",
							key: "hoverPreviewEnabled",
						},
					},
					{
						name: "Preview length (words)",
						desc: "How many leading words of the note body to show in the hover preview.",
						aliases: ["tooltip", "hover", "words"],
						control: {
							type: "number",
							key: "hoverPreviewWords",
							min: 10,
							max: 500,
							step: 10,
							placeholder: "300",
							validate: (value) =>
								value >= 10 && value <= 500 ? undefined : "Enter a number between 10 and 500",
						},
					},
				],
			},
			{
				type: "group",
				heading: "Data",
				items: [
					{
						name: "Reset all plugin data",
						desc: "Usage statistics and node positions. Settings are kept.",
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
		}
	}

	private async resetAllData(): Promise<void> {
		this.plugin.usageLog = emptyLog();
		await this.plugin.dataStore.saveUsage(this.plugin.usageLog);
		await this.plugin.dataStore.savePositions({});
		new Notice("Advanced Graph View data reset");
	}
}

function downloadText(fileName: string, content: string): void {
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const anchor = createEl("a", { attr: { href: url, download: fileName } });
	anchor.click();
	URL.revokeObjectURL(url);
}
