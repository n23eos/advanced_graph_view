// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { initI18n } from "../i18n";
import { installObsidianDom } from "../test/obsidianDom";
import { FilterChips } from "./FilterChips";
import { FloatingLayout } from "./FloatingLayout";
import { SearchBar, type SearchCallbacks } from "./SearchBar";
import { TimelineBar } from "./TimelineBar";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.empty();
});

interface HostWindow extends Window {
	Event: typeof Event;
	MouseEvent: typeof MouseEvent;
	HTMLCanvasElement: typeof HTMLCanvasElement;
}

interface HostRealm {
	frame: HTMLIFrameElement;
	window: HostWindow;
	document: Document;
	host: HTMLElement;
}

function createHostRealm(): HostRealm {
	const frame = document.body.createEl("iframe");
	const hostWindow = frame.contentWindow as unknown as HostWindow;
	installObsidianDom(hostWindow);
	const hostDocument = hostWindow.document;
	const host = hostDocument.body.createDiv();
	return { frame, window: hostWindow, document: hostDocument, host };
}

function searchCallbacks(): SearchCallbacks {
	return {
		onQueryChange: vi.fn(),
		onCommit: vi.fn(),
		onClear: vi.fn(),
		onSavePreset: vi.fn(),
		onPresetApplied: vi.fn(),
		onManagePresets: vi.fn(),
		onTasksMenu: vi.fn(),
		onConstraintRemove: vi.fn(),
		onResetConstraints: vi.fn(),
	};
}

describe("UI host window isolation", () => {
	test("filter chips use the owner document and animation frame", () => {
		const realm = createHostRealm();
		const addListener = vi.spyOn(realm.document, "addEventListener");
		const removeListener = vi.spyOn(realm.document, "removeEventListener");
		const hostRequest = vi.spyOn(realm.window, "requestAnimationFrame").mockReturnValue(71);
		const hostCancel = vi.spyOn(realm.window, "cancelAnimationFrame").mockImplementation(() => undefined);
		const globalRequest = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(91);
		const filters = new FilterChips(realm.host, { onChange: vi.fn() });
		filters.setVocabulary(["work"], []);

		const trigger = realm.host.querySelector("button") as HTMLButtonElement;
		trigger.click();
		const search = realm.host.querySelector("input[type=search]") as HTMLInputElement;
		search.value = "work";
		search.dispatchEvent(new realm.window.Event("input"));

		expect(hostRequest).toHaveBeenCalledOnce();
		expect(globalRequest).not.toHaveBeenCalled();
		document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		realm.document.body.dispatchEvent(new realm.window.MouseEvent("click", { bubbles: true }));
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(hostCancel).toHaveBeenCalledWith(71);

		const clickListener = addListener.mock.calls.find(([type]) => type === "click");
		filters.destroy();
		expect(clickListener).toBeDefined();
		expect(removeListener).toHaveBeenCalledWith("click", clickListener?.[1], true);
		realm.frame.remove();
	});

	test("search timers are created and cleared by the owner window", () => {
		const realm = createHostRealm();
		const hostSet = vi.spyOn(realm.window, "setTimeout").mockReturnValue(41);
		const hostClear = vi.spyOn(realm.window, "clearTimeout").mockImplementation(() => undefined);
		const globalSet = vi.spyOn(window, "setTimeout").mockReturnValue(81);
		const bar = new SearchBar(realm.host, searchCallbacks());
		const input = realm.host.querySelector("input") as HTMLInputElement;

		input.dispatchEvent(new realm.window.Event("blur"));
		expect(hostSet).toHaveBeenCalledOnce();
		expect(globalSet).not.toHaveBeenCalled();
		bar.destroy();
		expect(hostClear).toHaveBeenCalledWith(41);
		realm.frame.remove();
	});

	test("timeline uses owner styles and interval lifecycle", () => {
		const realm = createHostRealm();
		const context = {
			clearRect: vi.fn(),
			fillRect: vi.fn(),
			fillStyle: "",
			globalAlpha: 1,
		} as unknown as CanvasRenderingContext2D;
		Object.defineProperty(realm.window.HTMLCanvasElement.prototype, "getContext", {
			configurable: true,
			value: vi.fn(() => context),
		});
		const hostStyle = vi.spyOn(realm.window, "getComputedStyle").mockReturnValue({
			getPropertyValue: () => "#123456",
		} as unknown as CSSStyleDeclaration);
		const globalStyle = vi.spyOn(window, "getComputedStyle");
		const hostSet = vi.spyOn(realm.window, "setInterval").mockReturnValue(51);
		const hostClear = vi.spyOn(realm.window, "clearInterval").mockImplementation(() => undefined);
		const globalSet = vi.spyOn(window, "setInterval").mockReturnValue(82);
		const bar = new TimelineBar(realm.host, { onCutoffChange: vi.fn(), onModeChange: vi.fn() });

		bar.setTimestamps([Date.UTC(2026, 0, 1), Date.UTC(2026, 2, 1)]);
		expect(hostStyle).toHaveBeenCalledWith(realm.document.body);
		expect(globalStyle).not.toHaveBeenCalled();
		(realm.host.querySelector("button") as HTMLButtonElement).click();
		expect(hostSet).toHaveBeenCalledOnce();
		expect(globalSet).not.toHaveBeenCalled();
		bar.destroy();
		expect(hostClear).toHaveBeenCalledWith(51);
		realm.frame.remove();
	});

	test("floating layout observes with the owner window", () => {
		const realm = createHostRealm();
		const observe = vi.fn();
		const disconnect = vi.fn();
		class HostResizeObserver {
			constructor(_callback: ResizeObserverCallback) {}
			observe = observe;
			unobserve = vi.fn();
			disconnect = disconnect;
		}
		Object.defineProperty(realm.window, "ResizeObserver", {
			configurable: true,
			value: HostResizeObserver,
		});

		const layout = new FloatingLayout(realm.host, vi.fn());
		expect(observe).toHaveBeenCalledWith(realm.host);
		layout.destroy();
		expect(disconnect).toHaveBeenCalledOnce();
		realm.frame.remove();
	});
});
