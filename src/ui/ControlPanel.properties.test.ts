// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { initI18n } from "../i18n";
import { installObsidianDom } from "../test/obsidianDom";
import { DEFAULT_3D_PANEL } from "../view/builtinPresets";
import { ControlPanel, type PanelCallbacks, type PanelMode, type PanelState } from "./ControlPanel";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

function callbacks(onChange = vi.fn()): PanelCallbacks {
	return {
		onPresetApply: vi.fn(), onPresetSaveRequest: vi.fn(), onPresetDelete: vi.fn(), onChange,
		onReheat: vi.fn(), onClusterClick: vi.fn(), onClusterToggle: vi.fn(), onTrailReplay: vi.fn(),
		onShowHiddenNodes: vi.fn(), onResetViewState: vi.fn(), onModeChange: vi.fn(),
		onPhysicsReset: vi.fn(), onSectionToggle: vi.fn(), onTasksMenu: vi.fn(),
	};
}

function propertySelect(host: HTMLElement): HTMLSelectElement {
	const select = Array.from(host.querySelectorAll("select")).find((candidate) =>
		Array.from(candidate.options).some((option) => option.value === "prop:status"));
	if (!select) throw new Error("property color selector not rendered");
	return select;
}

function build(mode: PanelMode, state: PanelState, keys: readonly string[], onChange = vi.fn()) {
	const host = document.body.createDiv();
	const panel = new ControlPanel(host, state, callbacks(onChange), mode, undefined, keys);
	return { host, panel, onChange };
}

describe.each(["simple", "expert"] as const)("%s property color selector", (mode) => {
	test("offers discovered keys and reports the selected dynamic metric", () => {
		const { host, onChange } = build(mode, DEFAULT_3D_PANEL, ["status", "team"]);
		const select = propertySelect(host);
		expect(Array.from(select.options).map((option) => option.value)).toContain("prop:team");
		select.value = "prop:status";
		select.dispatchEvent(new Event("change"));
		expect((onChange.mock.calls[0][0] as PanelState).channels.color).toBe("prop:status");
	});
});

test("keeps an active saved key absent from discovered facts and after option refresh", () => {
	const state = { ...DEFAULT_3D_PANEL, channels: { ...DEFAULT_3D_PANEL.channels, color: "prop:missing" as const } };
	const { host, panel } = build("expert", state, ["status"]);
	expect(Array.from(propertySelect(host).options).some((option) => option.value === "prop:missing" && option.selected)).toBe(true);
	panel.setPropertyKeys(["team"]);
	const refreshed = Array.from(host.querySelectorAll("select")).find((candidate) =>
		Array.from(candidate.options).some((option) => option.value === "prop:missing"));
	expect(refreshed?.value).toBe("prop:missing");
});

test("keeps the hidden-node count when property options rebuild the panel", () => {
	const { host, panel } = build("expert", DEFAULT_3D_PANEL, ["status"]);
	panel.setHiddenNodeCount(4);
	panel.setPropertyKeys(["status", "team"]);
	const hiddenRow = Array.from(host.querySelectorAll(".graph-insight-panel-row")).find((row) =>
		row.querySelector(".graph-insight-panel-label")?.textContent === "Hidden nodes");
	expect(hiddenRow?.querySelector(".graph-insight-panel-count")?.textContent).toBe("4");
});
