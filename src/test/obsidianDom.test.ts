// @vitest-environment jsdom
import { beforeAll, describe, expect, test } from "vitest";
import { installObsidianDom } from "./obsidianDom";

beforeAll(() => installObsidianDom());

const host = (): HTMLElement => document.createElement("div");

describe("jsdom + Obsidian DOM helpers", () => {
	test("the DOM environment is available", () => {
		expect(document.body).toBeDefined();
	});

	test("createEl appends and applies class, text and attributes", () => {
		const root = host();
		const el = root.createEl("button", { cls: "a", text: "Go", attr: { "aria-label": "Go" } });
		expect(el.parentElement).toBe(root);
		expect(el.className).toBe("a");
		expect(el.textContent).toBe("Go");
		expect(el.getAttribute("aria-label")).toBe("Go");
	});

	test("a string second argument is shorthand for cls", () => {
		expect(host().createDiv("panel").className).toBe("panel");
	});

	test("createDiv, createSpan, empty, setText, toggleClass, addClass work", () => {
		const root = host();
		root.createDiv({ cls: ["x", "y"] });
		const span = root.createSpan({ text: "Hi" });
		span.setText("Bye");
		expect(span.textContent).toBe("Bye");
		root.toggleClass("on", true);
		expect(root.classList.contains("on")).toBe(true);
		root.addClass("m", "n");
		expect(root.classList.contains("n")).toBe(true);
		root.empty();
		expect(root.childElementCount).toBe(0);
	});
});
