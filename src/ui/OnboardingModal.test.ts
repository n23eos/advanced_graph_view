// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { OnboardingModal } from "./OnboardingModal";
import type { App } from "obsidian";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

function build() {
	const onResult = vi.fn();
	const modal = new OnboardingModal({} as App, onResult);
	modal.onOpen();
	return { modal, onResult, content: modal.contentEl };
}

const buttonByText = (content: HTMLElement, text: string): HTMLButtonElement => {
	const found = Array.from(content.querySelectorAll("button")).find((b) => b.textContent === text);
	if (!found) throw new Error(`no button "${text}"`);
	return found;
};

describe("OnboardingModal (F-02)", () => {
	test("shows one step at a time; Next and Back walk the tour", () => {
		const { content } = build();
		expect(content.textContent).toContain("Pick a note");
		expect(content.textContent).not.toContain("Try a filter");
		buttonByText(content, "Next").click();
		expect(content.textContent).toContain("Try a filter");
		buttonByText(content, "Back").click();
		expect(content.textContent).toContain("Pick a note");
	});

	test("Next on the last step completes the tour", () => {
		const { content, onResult } = build();
		buttonByText(content, "Next").click();
		buttonByText(content, "Next").click();
		buttonByText(content, "Next").click();
		expect(onResult).toHaveBeenCalledWith("completed");
	});

	test("Skip dismisses without disabling", () => {
		const { content, onResult } = build();
		buttonByText(content, "Skip").click();
		expect(onResult).toHaveBeenCalledWith("dismissed");
	});

	test("Don't show again disables the tour", () => {
		const { content, onResult } = build();
		buttonByText(content, "Don't show again").click();
		expect(onResult).toHaveBeenCalledWith("disabled");
	});

	test("closing with the X counts as Skip, reported exactly once", () => {
		const { modal, onResult } = build();
		modal.onClose();
		modal.onClose();
		expect(onResult).toHaveBeenCalledTimes(1);
		expect(onResult).toHaveBeenCalledWith("dismissed");
	});
});
