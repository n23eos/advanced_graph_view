import { describe, expect, test, vi } from "vitest";
import { GraphInsightSettingsTab } from "./SettingsTab";
import { normalizeSettings } from "./normalize";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	PluginSettingTab: class {
		constructor(_app: unknown, _plugin: unknown) {}
		update(): void {}
	},
}));

function buildTab() {
	const plugin = {
		settings: normalizeSettings({}),
		saveData: vi.fn(async () => {}),
		reloadGraphViews: vi.fn(async () => {}),
	};
	const tab = new GraphInsightSettingsTab({} as never, plugin as never);
	return { plugin, tab };
}

describe("render scale settings", () => {
	test.each([undefined, null, "ultra", 2])("normalizes %j to standard resolution", (renderScale) => {
		expect(normalizeSettings({ renderScale }).renderScale).toBe("standard");
	});

	test.each(["standard", "high"] as const)("preserves the supported %s value", (renderScale) => {
		expect(normalizeSettings({ renderScale }).renderScale).toBe(renderScale);
	});

	test("exposes high resolution as a declarative toggle", () => {
		const { tab } = buildTab();
		const groups = tab.getSettingDefinitions() as Array<{
			items?: Array<{ control?: { type: string; key: string } }>;
		}>;
		const setting = groups.flatMap((group) => group.items ?? [])
			.find((item) => item.control?.key === "renderScaleHigh");

		expect(setting?.control).toEqual({ type: "toggle", key: "renderScaleHigh" });
	});

	test("maps the toggle to the persisted render scale", async () => {
		const { plugin, tab } = buildTab();
		expect(tab.getControlValue("renderScaleHigh")).toBe(false);
		let finishSave!: () => void;
		plugin.saveData.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));

		const enabling = tab.setControlValue("renderScaleHigh", true);
		await Promise.resolve();
		expect(plugin.settings.renderScale).toBe("high");
		expect(plugin.saveData).toHaveBeenLastCalledWith(expect.objectContaining({ renderScale: "high" }));
		expect(plugin.reloadGraphViews).not.toHaveBeenCalled();
		finishSave();
		await enabling;
		expect(plugin.reloadGraphViews).toHaveBeenCalledOnce();
		expect(plugin.saveData.mock.invocationCallOrder[0]).toBeLessThan(
			plugin.reloadGraphViews.mock.invocationCallOrder[0]
		);

		await tab.setControlValue("renderScaleHigh", false);
		expect(plugin.settings.renderScale).toBe("standard");
		expect(plugin.saveData).toHaveBeenLastCalledWith(expect.objectContaining({ renderScale: "standard" }));
		expect(plugin.reloadGraphViews).toHaveBeenCalledTimes(2);
	});
});
