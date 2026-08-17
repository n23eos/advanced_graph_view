import {
	Notice,
	PluginSettingTab,
	type App,
	type SettingDefinitionItem,
} from "obsidian";
import { emptyLog } from "../data/UsageTracker";
import { emptySnapshotStore } from "../data/graphSnapshots";
import { usageToCsv } from "../export/exporters";
import { t } from "../i18n";
import { ConfirmModal } from "../ui/ConfirmModal";
import { buildProfile, mergeProfile } from "./profile";
import { isLayoutRule } from "./normalize";
import { DEFAULT_SETTINGS } from "./schema";
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
						name: t("settings.showOnboarding"),
						desc: t("settings.showOnboarding.desc"),
						aliases: ["onboarding", "tour", "intro", "help"],
						action: () => this.plugin.showOnboarding(),
					},
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
				heading: t("settings.group.profile"),
				items: [
					{
						name: t("settings.exportProfile"),
						desc: t("settings.exportProfile.desc"),
						aliases: ["backup", "profile", "share"],
						action: () => {
							const profile = buildProfile(this.plugin.settings);
							downloadText(
								"advanced-graph-view-settings.json",
								JSON.stringify(profile, null, 2)
							);
						},
					},
					{
						name: t("settings.importProfile"),
						desc: t("settings.importProfile.desc"),
						aliases: ["restore", "profile", "load"],
						action: () => pickJsonFile((raw) => void this.importProfile(raw)),
					},
					{
						name: t("settings.resetSettings"),
						desc: t("settings.resetSettings.desc"),
						aliases: ["defaults", "restore"],
						action: () =>
							this.confirm(t("settings.resetSettings.confirm"), () =>
								void this.resetSettings()
							),
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
						action: () =>
							this.confirm(t("settings.resetAll.confirm"), () => void this.resetAllData()),
					},
				],
			},
		];
	}

	private confirm(message: string, onConfirm: () => void): void {
		new ConfirmModal(this.app, message, onConfirm).open();
	}

	private async importProfile(raw: string): Promise<void> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			new Notice(t("notice.profileInvalid"));
			return;
		}
		const merged = mergeProfile(this.plugin.settings, parsed);
		if (!merged) {
			new Notice(t("notice.profileInvalid"));
			return;
		}
		await this.plugin.replaceSettings(merged);
		// mergeProfile already fell back to "links"; tell the user once why.
		const panel = (parsed as { panel?: { layoutRule?: unknown } }).panel;
		if (panel && "layoutRule" in panel && !isLayoutRule(panel.layoutRule)) {
			new Notice(t("notice.layoutRuleUnknown"));
		}
		new Notice(t("notice.profileImported"));
		this.update();
	}

	/**
	 * Back to defaults, with the bundled view presets re-seeded — zeroing the
	 * preset version is what makes the next load rebuild them. Usage history is
	 * a separate concern and is deliberately left alone.
	 */
	private async resetSettings(): Promise<void> {
		await this.plugin.replaceSettings({ ...DEFAULT_SETTINGS, viewPresetsVersion: 0 });
		new Notice(t("notice.settingsReset"));
		this.update();
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
		// F-10: the topology history goes with "all data" (reset settings keeps it).
		this.plugin.snapshotStore = emptySnapshotStore();
		await this.plugin.dataStore.removeSnapshots();
		new Notice(t("notice.dataReset"));
	}
}

/** Opens the OS file picker and hands back the file's text. */
function pickJsonFile(onLoad: (raw: string) => void): void {
	const input = createEl("input", { attr: { type: "file", accept: "application/json,.json" } });
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		if (!file) return;
		void file.text().then(onLoad);
	});
	input.click();
}

function downloadText(fileName: string, content: string): void {
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const anchor = createEl("a", { attr: { href: url, download: fileName } });
	anchor.click();
	URL.revokeObjectURL(url);
}
