// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { CameraWidget, type CameraWidgetCallbacks } from "./CameraWidget";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

function build() {
	const onFit = vi.fn();
	const onReset = vi.fn();
	const callbacks: CameraWidgetCallbacks = {
		onToggle3D: vi.fn(),
		onToggleFreeLayout: vi.fn(),
		onFit,
		onReset,
		onToggleUI: vi.fn(),
		onToggleExplore: vi.fn(),
	};
	const host = document.body.createDiv();
	const widget = new CameraWidget(host, { enabled: true, depthSource: "physics", focal: 900 }, true, callbacks);
	return { host, widget, onFit, onReset };
}

const byAria = (host: HTMLElement, label: string): HTMLButtonElement => {
	const found = host.querySelector(`button[aria-label="${label}"]`);
	if (!found) throw new Error(`no button "${label}"`);
	return found as HTMLButtonElement;
};

describe("CameraWidget (F-06)", () => {
	test("the X/Y offset sliders are gone", () => {
		const { host } = build();
		expect(host.querySelectorAll("input[type=range]").length).toBe(0);
	});

	test("fit and reset are separate buttons with distinct labels and callbacks", () => {
		const { host, onFit, onReset } = build();
		byAria(host, "Fit whole graph").click();
		expect(onFit).toHaveBeenCalledTimes(1);
		expect(onReset).not.toHaveBeenCalled();
		byAria(host, "Reset camera").click();
		expect(onReset).toHaveBeenCalledTimes(1);
	});
});
