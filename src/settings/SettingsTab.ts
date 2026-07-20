import {
	Notice,
	PluginSettingTab,
	type App,
	type SettingDefinitionItem,
} from "obsidian";
import { emptyLog } from "../data/UsageTracker";
import { usageToCsv } from "../export/exporters";
import { SemanticConsentModal } from "../ui/ConsentModal";
import type GraphInsightPlugin from "../main";

/** Keys addressed by the declarative settings API. */
type SettingKey = "openDwellSeconds" | "semanticsEnabled" | "semanticsThreshold";

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
				heading: "Semantics",
				items: [
					{
						name: "Semantic index",
						desc: "Downloads the all-MiniLM-L6-v2 model (~25 MB) once, then works offline.",
						aliases: ["embeddings", "similar", "ai"],
						control: { type: "toggle", key: "semanticsEnabled" },
					},
					{
						name: "Default similarity threshold",
						desc: "Higher values keep only very close pairs.",
						aliases: ["embeddings", "similar"],
						control: {
							type: "slider",
							key: "semanticsThreshold",
							min: 0.5,
							max: 0.95,
							step: 0.01,
							displayFormat: (value) => value.toFixed(2),
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
						desc: "Usage statistics, node positions and the semantic index. Settings are kept.",
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
			case "semanticsEnabled":
				return this.plugin.settings.semantics.enabled;
			case "semanticsThreshold":
				return this.plugin.settings.semantics.threshold;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key as SettingKey) {
			case "openDwellSeconds":
				this.plugin.settings = { ...this.plugin.settings, openDwellSeconds: value as number };
				await this.plugin.saveData(this.plugin.settings);
				return;
			case "semanticsThreshold":
				await this.plugin.saveSemanticSettings({
					...this.plugin.settings.semantics,
					threshold: value as number,
				});
				return;
			case "semanticsEnabled":
				await this.setSemanticsEnabled(value as boolean);
				return;
		}
	}

	/** The model download needs consent — asked once, ever. */
	private async setSemanticsEnabled(enabled: boolean): Promise<void> {
		const current = this.plugin.settings.semantics;
		if (enabled && !current.consentGiven) {
			new SemanticConsentModal(this.app, () => {
				void (async () => {
					await this.plugin.saveSemanticSettings({
						...current,
						enabled: true,
						consentGiven: true,
					});
					await this.plugin.semantics.enable();
				})();
			}).open();
			return;
		}
		await this.plugin.saveSemanticSettings({ ...current, enabled });
		if (enabled) await this.plugin.semantics.enable();
		else this.plugin.semantics.disable();
	}

	private async resetAllData(): Promise<void> {
		this.plugin.usageLog = emptyLog();
		await this.plugin.dataStore.saveUsage(this.plugin.usageLog);
		await this.plugin.dataStore.savePositions({});
		await this.plugin.dataStore.writeJsonFile("embeddings-index.json", {
			dim: 384,
			paths: [],
			hashes: [],
		});
		await this.plugin.dataStore.writeBinaryFile("embeddings.bin", new ArrayBuffer(0));
		new Notice("Graph Insight data reset");
	}
}

function downloadText(fileName: string, content: string): void {
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const anchor = createEl("a", { attr: { href: url, download: fileName } });
	anchor.click();
	URL.revokeObjectURL(url);
}
