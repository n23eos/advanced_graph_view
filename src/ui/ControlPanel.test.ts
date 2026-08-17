// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { ControlPanel, type PanelCallbacks, type PanelMode, type PanelState } from "./ControlPanel";
import { DEFAULT_3D_PANEL } from "../view/builtinPresets";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

function makeCallbacks(): PanelCallbacks {
	return {
		onPresetApply: vi.fn(),
		onPresetSaveRequest: vi.fn(),
		onPresetDelete: vi.fn(),
		onChange: vi.fn(),
		onReheat: vi.fn(),
		onClusterClick: vi.fn(),
		onClusterToggle: vi.fn(),
		onTrailReplay: vi.fn(),
		onShowHiddenNodes: vi.fn(),
		onResetViewState: vi.fn(),
		onModeChange: vi.fn(),
		onPhysicsReset: vi.fn(),
		onSectionToggle: vi.fn(),
	};
}

function build(state: PanelState, mode: PanelMode = "expert", overrides: Partial<PanelCallbacks> = {}) {
	const host = document.body.createDiv();
	const panel = new ControlPanel(host, state, { ...makeCallbacks(), ...overrides }, mode);
	return { host, panel };
}

/** The layout-rule dropdown is the one offering the "links" option. */
function layoutRuleSelect(host: HTMLElement): HTMLSelectElement {
	const selects = Array.from(host.querySelectorAll("select"));
	const found = selects.find((select) =>
		Array.from(select.options).some((option) => option.value === "links")
	);
	if (!found) throw new Error("layout rule select not rendered");
	return found;
}

describe("layout rule selector (F-05)", () => {
	test("reflects the persisted PanelState value instead of always showing links", () => {
		const { host } = build({ ...DEFAULT_3D_PANEL, layoutRule: "tags" });
		expect(layoutRuleSelect(host).value).toBe("tags");
	});

	test("changing the rule reports a full PanelState with the new rule", () => {
		const onChange = vi.fn();
		const { host } = build({ ...DEFAULT_3D_PANEL, layoutRule: "links" }, "expert", { onChange });
		const select = layoutRuleSelect(host);
		select.value = "folders";
		select.dispatchEvent(new Event("change"));
		expect(onChange).toHaveBeenCalledTimes(1);
		expect((onChange.mock.calls[0][0] as PanelState).layoutRule).toBe("folders");
	});

	test("the simple mode selector shows the same persisted value", () => {
		const { host } = build({ ...DEFAULT_3D_PANEL, layoutRule: "hubs" }, "simple");
		expect(layoutRuleSelect(host).value).toBe("hubs");
	});
});
