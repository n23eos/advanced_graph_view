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
type SettingKey = "openDwellSeconds";

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
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key as SettingKey) {
			case "openDwellSeconds":
				this.plugin.settings = { ...this.plugin.settings, openDwellSeconds: value as number };
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
