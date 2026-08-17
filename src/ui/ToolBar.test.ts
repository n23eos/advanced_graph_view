// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { ToolBar, type ToolBarCallbacks } from "./ToolBar";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

function build(overrides: Partial<ToolBarCallbacks> = {}) {
	const callbacks: ToolBarCallbacks = {
		onToolChange: vi.fn(),
		onDepthChange: vi.fn(),
		onToggleFollow: vi.fn(),
		onToggleSidePane: vi.fn(),
		onOpenLocalGraph: vi.fn(),
		onOverflowMenu: vi.fn(),
		...overrides,
	};
	const host = document.body.createDiv();
	const bar = new ToolBar(host, "open", 2, false, false, callbacks);
	const toolButtons = Array.from(host.querySelectorAll("button.graph-insight-tool"));
	return { host, bar, toolButtons };
}

const statusEl = (host: HTMLElement): HTMLElement =>
	host.querySelector(".graph-insight-toolbar-status") as HTMLElement;

describe("tool status (F-08)", () => {
	test("renders a real, polite status element for the active tool", () => {
		const { host } = build();
		const status = statusEl(host);
		expect(status).not.toBeNull();
		expect(status.getAttribute("aria-live")).toBe("polite");
		expect(status.textContent).toBe("Open — click a note");
	});

	test("clicking a tool updates the status text", () => {
		const { host, toolButtons } = build();
		(toolButtons[1] as HTMLButtonElement).click();
		expect(statusEl(host).textContent).toBe("Links — pick a note");
	});

	test("the path tool distinguishes the start and end picks", () => {
		const { host, bar, toolButtons } = build();
		(toolButtons[2] as HTMLButtonElement).click();
		expect(statusEl(host).textContent).toBe("Path — pick the start");
		bar.setPathStage("end");
		expect(statusEl(host).textContent).toBe("Path — pick the end note");
		// Switching tools resets the sub-state.
		(toolButtons[0] as HTMLButtonElement).click();
		(toolButtons[2] as HTMLButtonElement).click();
		expect(statusEl(host).textContent).toBe("Path — pick the start");
	});

	test("compact and minimal widths shorten the status to the tool name (F-04)", () => {
		const { host, bar, toolButtons } = build();
		(toolButtons[2] as HTMLButtonElement).click();
		bar.setResponsiveMode("compact");
		expect(statusEl(host).textContent).toBe("Path");
		bar.setResponsiveMode("full");
		expect(statusEl(host).textContent).toBe("Path — pick the start");
	});

	test("follow and side pane show badges next to the status", () => {
		const { host, bar } = build();
		const badges = () => host.querySelector(".graph-insight-toolbar-badges")?.textContent ?? "";
		expect(badges()).toBe("");
		bar.setFollowing(true);
		expect(badges()).toContain("Follow");
		bar.setSidePane(true);
		expect(badges()).toContain("Side pane");
		bar.setFollowing(false);
		expect(badges()).not.toContain("Follow");
	});
});
