import { expect, test, vi } from "vitest";
import { GraphInsightSettingsTab } from "./SettingsTab";
import { normalizeSettings } from "./normalize";
import { buildProfile, mergeProfile } from "./profile";
vi.mock("obsidian", async original => ({ ...await original<object>(), PluginSettingTab: class {} }));
test("membership toggles persist before both views reload", async () => {
	const plugin = { settings: normalizeSettings({}), saveData: vi.fn(async () => {}), reloadGraphViews: vi.fn(async () => {}) };
	const tab = new GraphInsightSettingsTab({} as never, plugin as never);
	expect(tab.getControlValue("allAttachments")).toBe(false);
	expect(tab.getControlValue("unresolvedNodes")).toBe(false);
	await tab.setControlValue("allAttachments", true);
	await tab.setControlValue("unresolvedNodes", true);
	expect(plugin.settings.graphScope).toEqual({ attachments: true, unresolved: true });
	expect(plugin.reloadGraphViews).toHaveBeenCalledTimes(2);
	expect(plugin.saveData.mock.invocationCallOrder[0]).toBeLessThan(plugin.reloadGraphViews.mock.invocationCallOrder[0]);
});
test("profile scope round-trips and old profiles preserve current scope", () => {
	const settings = normalizeSettings({ graphScope: { attachments: true, unresolved: true } });
	expect(mergeProfile(normalizeSettings({}), buildProfile(settings))?.graphScope).toEqual(settings.graphScope);
	expect(mergeProfile(settings, { version: 1 })?.graphScope).toEqual(settings.graphScope);
});
