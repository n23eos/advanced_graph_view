// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";
import { renderBreadcrumb, visibleIndexes } from "./breadcrumb";

beforeAll(() => {
	installObsidianDom();
	initI18n("en");
});

const trailOf = (paths: string[], activeIndex = paths.length - 1) => ({
	items: paths.map((path) => ({ path, label: path })),
	activeIndex,
});

describe("visibleIndexes (F-11)", () => {
	test("wide bars show everything", () => {
		expect(visibleIndexes(6, 5, false)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	test("narrow bars keep first, second-to-last and active", () => {
		expect(visibleIndexes(6, 5, true)).toEqual([0, 4, 5]);
		expect(visibleIndexes(6, 2, true)).toEqual([0, 2, 4]);
	});

	test("short trails never collapse", () => {
		expect(visibleIndexes(3, 2, true)).toEqual([0, 1, 2]);
	});
});

describe("renderBreadcrumb", () => {
	test("collapsed middle renders an ellipsis between crumbs", () => {
		const host = document.body.createDiv();
		renderBreadcrumb(host, trailOf(["a", "b", "c", "d", "e", "f"]), () => false, true, {
			onCrumb: vi.fn(),
			onRemove: vi.fn(),
		});
		const texts = Array.from(host.children).map((el) => el.textContent);
		expect(texts).toEqual(["a", "…", "e", "›", "f"]);
	});

	test("clicking a crumb reports its index; the active crumb is marked", () => {
		const onCrumb = vi.fn();
		const host = document.body.createDiv();
		renderBreadcrumb(host, trailOf(["a", "b", "c"], 1), () => false, false, {
			onCrumb,
			onRemove: vi.fn(),
		});
		const crumbs = Array.from(host.querySelectorAll("button.graph-insight-breadcrumb-crumb"));
		expect(crumbs[1].classList.contains("is-active")).toBe(true);
		(crumbs[2] as HTMLButtonElement).click();
		expect(onCrumb).toHaveBeenCalledWith(2);
	});

	test("a missing note renders disabled with a remove button", () => {
		const onRemove = vi.fn();
		const host = document.body.createDiv();
		renderBreadcrumb(host, trailOf(["a", "gone", "c"]), (path) => path === "gone", false, {
			onCrumb: vi.fn(),
			onRemove,
		});
		const crumbs = Array.from(
			host.querySelectorAll<HTMLButtonElement>("button.graph-insight-breadcrumb-crumb")
		);
		expect(crumbs[1].disabled).toBe(true);
		(host.querySelector(".graph-insight-breadcrumb-remove") as HTMLButtonElement).click();
		expect(onRemove).toHaveBeenCalledWith(1);
	});
});
