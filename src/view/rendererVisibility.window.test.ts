// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { observeRendererVisibility } from "./rendererVisibility";

describe("renderer visibility in a popout window", () => {
	beforeAll(() => installObsidianDom());

	afterEach(() => {
		document.body.innerHTML = "";
		vi.unstubAllGlobals();
	});

	test("constructs and disconnects the observer from the host window", () => {
		const iframe = document.body.createEl("iframe");
		const ownerWindow = iframe.contentWindow!;
		installObsidianDom(ownerWindow);
		const host = ownerWindow.document.body.createDiv();
		let callback!: IntersectionObserverCallback;
		const disconnect = vi.fn();
		const observe = vi.fn();
		let ownerObservers = 0;
		class OwnerObserver {
			disconnect = disconnect;
			observe = observe;
			constructor(onChange: IntersectionObserverCallback) {
				ownerObservers++;
				callback = onChange;
			}
		}
		Object.defineProperty(ownerWindow, "IntersectionObserver", {
			configurable: true,
			value: OwnerObserver,
		});
		let globalObservers = 0;
		class GlobalObserver {
			constructor() { globalObservers++; }
			disconnect(): void {}
			observe(): void {}
		}
		vi.stubGlobal("IntersectionObserver", GlobalObserver);
		const renderer = { pause: vi.fn(), resume: vi.fn(), resize: vi.fn() };

		const stop = observeRendererVisibility(host, renderer);

		expect(ownerObservers).toBe(1);
		expect(globalObservers).toBe(0);
		expect(observe).toHaveBeenCalledWith(host);
		stop();
		callback(
			[{ target: host, isIntersecting: true } as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		expect(disconnect).toHaveBeenCalledOnce();
		expect(renderer.resume).not.toHaveBeenCalled();
	});
});
