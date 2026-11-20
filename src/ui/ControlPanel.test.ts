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
		onTasksMenu: vi.fn(),
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

function rowByLabel(host: HTMLElement, label: string): HTMLElement {
	const row = Array.from(host.querySelectorAll<HTMLElement>(".graph-insight-panel-row"))
		.find((candidate) => candidate.textContent?.includes(label));
	if (!row) throw new Error(`Control row not rendered: ${label}`);
	return row;
}

function sliderAfter(row: HTMLElement): HTMLInputElement {
	const slider = row.nextElementSibling;
	if (!(slider instanceof HTMLInputElement) || slider.type !== "range") {
		throw new Error(`Slider not rendered after: ${row.textContent ?? ""}`);
	}
	return slider;
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

describe("tasks entry in the simple panel (F-01)", () => {
	test("the simple panel offers the Tasks… menu through the host", () => {
		const onTasksMenu = vi.fn();
		const { host } = build(DEFAULT_3D_PANEL, "simple", { onTasksMenu });
		const button = Array.from(host.querySelectorAll("button")).find(
			(b) => b.textContent === "Tasks…"
		);
		expect(button).toBeDefined();
		(button as HTMLButtonElement).click();
		expect(onTasksMenu).toHaveBeenCalledTimes(1);
	});
});

describe("node style", () => {
	test("expert mode exposes and persists the node style", () => {
		const onChange = vi.fn();
		const { host } = build({ ...DEFAULT_3D_PANEL, nodeStyle: "glow" }, "expert", { onChange });
		const select = Array.from(host.querySelectorAll("select")).find((candidate) =>
			Array.from(candidate.options).some((option) => option.value === "ring")
		);
		expect(select?.value).toBe("glow");
		select!.value = "ring";
		select!.dispatchEvent(new Event("change"));
		expect((onChange.mock.calls[0][0] as PanelState).nodeStyle).toBe("ring");
	});
});

describe("build 3 appearance controls", () => {
	test("shows saved label, edge, folder and glow values", () => {
		const state = {
			...DEFAULT_3D_PANEL,
			glowIntensity: 1.5,
			labels: {
				...DEFAULT_3D_PANEL.labels,
				hoverOnly: true,
				hubs: 12,
				fadeMs: 250,
				rank: "pagerank" as const,
			},
			edges: { ...DEFAULT_3D_PANEL.edges, curvature: 0.24 },
			folders: { enabled: true, level: "parent" as const, overrides: { Work: "#abcdef" } },
		};
		const { host } = build(state, "expert");

		expect(sliderAfter(rowByLabel(host, "Glow intensity")).value).toBe("1.5");
		expect(rowByLabel(host, "Only on hover").querySelector<HTMLInputElement>("input")?.checked).toBe(true);
		expect(sliderAfter(rowByLabel(host, "Hub labels")).value).toBe("12");
		expect(sliderAfter(rowByLabel(host, "Fade duration")).value).toBe("250");
		expect(rowByLabel(host, "Label ranking").querySelector<HTMLSelectElement>("select")?.value).toBe("pagerank");
		expect(sliderAfter(rowByLabel(host, "Curvature")).value).toBe("0.24");
		expect(rowByLabel(host, "Show folders").querySelector<HTMLInputElement>("input")?.checked).toBe(true);
		expect(rowByLabel(host, "Folder level").querySelector<HTMLSelectElement>("select")?.value).toBe("parent");
		expect(rowByLabel(host, "Color overrides").querySelector<HTMLInputElement>("input")?.value)
			.toBe("Work=#abcdef");
	});

	test("reports updated build 3 fields", () => {
		const onChange = vi.fn();
		const { host } = build(DEFAULT_3D_PANEL, "expert", { onChange });
		const curvature = sliderAfter(rowByLabel(host, "Curvature"));
		curvature.value = "0.3";
		curvature.dispatchEvent(new Event("input"));

		const changed = onChange.mock.calls.at(-1)?.[0] as PanelState;
		expect(changed.edges.curvature).toBe(0.3);
	});
});

test("panel disclosure is a keyboard-focusable button with synchronized expanded state", () => {
	const onChange = vi.fn();
	const { host } = build({ ...DEFAULT_3D_PANEL, collapsed: false }, "simple", { onChange });
	const header = host.querySelector<HTMLButtonElement>(".graph-insight-panel-header")!;
	expect(header.tagName).toBe("BUTTON");
	expect(header.getAttribute("aria-expanded")).toBe("true");
	header.click();
	expect(header.getAttribute("aria-expanded")).toBe("false");
	expect(host.querySelector(".graph-insight-panel")?.classList.contains("is-collapsed")).toBe(true);
	expect(host.querySelector(".graph-insight-panel-body")?.classList.contains("is-hidden")).toBe(true);
	expect((onChange.mock.calls[0][0] as PanelState).collapsed).toBe(true);
});

describe("dimension-specific controls", () => {
	test("switches camera controls and label units while preserving the saved values", () => {
		const state = { ...DEFAULT_3D_PANEL, view3d: { enabled: true, depthSource: "age" as const, focal: 1450 } };
		const onChange = vi.fn();
		const { host } = build(state, "expert", { onChange });
		const switchTo = (dimension: string) => {
			const select = host.querySelector<HTMLSelectElement>(".graph-insight-panel-modes select")!;
			select.value = dimension;
			select.dispatchEvent(new Event("change"));
		};

		expect(sliderAfter(rowByLabel(host, "Perspective")).value).toBe("1450");
		switchTo("2D");
		expect(host.textContent).not.toContain("Perspective");
		expect(host.textContent).not.toContain("Scale labels with depth");
		expect(host.textContent).toContain("Show labels from zoom");
		expect(onChange.mock.lastCall?.[0]).toEqual({ ...state, view3d: { ...state.view3d, enabled: false } });

		switchTo("3D");
		expect(host.textContent).not.toContain("Show labels from zoom");
		expect(host.textContent).toContain("Scale labels with depth");
		expect(sliderAfter(rowByLabel(host, "Perspective")).value).toBe("1450");
		expect(onChange.mock.lastCall?.[0]).toEqual(state);
	});
});
