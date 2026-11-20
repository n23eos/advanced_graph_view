// @vitest-environment jsdom
import { beforeAll, describe, expect, test } from "vitest";
import { installObsidianDom } from "../test/obsidianDom";
import { LabelOverlay } from "./LabelOverlay";

beforeAll(() => installObsidianDom());

describe("LabelOverlay", () => {
	test("keeps text in CSS pixels above a low-resolution scene", () => {
		const host = document.body.createDiv();
		const overlay = new LabelOverlay(host);

		overlay.sync([{
			id: 7,
			text: "Readable note",
			x: 120.5,
			y: 42.25,
			scale: 1.2,
			alpha: 0.75,
			weight: 600,
		}], {
			fontFamily: "Inter",
			fontSize: 8.5,
			fill: "#f4f4f5",
			halo: "#101014",
		});

		const layer = host.querySelector<HTMLElement>(".graph-insight-label-layer");
		const label = layer?.querySelector<HTMLElement>(".graph-insight-label");
		expect(layer?.style.inset).toBe("0px");
		expect(label?.textContent).toBe("Readable note");
		expect(label?.style.left).toBe("120.5px");
		expect(label?.style.top).toBe("42.25px");
		expect(label?.style.transform).toBe("translateX(-50%)");
		expect(label?.style.fontSize).toBe("10.2px");
		expect(label?.style.fontWeight).toBe("600");
		expect(label?.style.opacity).toBe("0.75");
		expect(layer?.style.textShadow).toContain("#101014");
	});

	test("reuses current labels and removes stale ones", () => {
		const host = document.body.createDiv();
		const overlay = new LabelOverlay(host);
		const appearance = { fontFamily: "sans-serif", fontSize: 11, fill: "#fff", halo: "#000" };

		overlay.sync([{ id: "folder", text: "First", x: 0, y: 0, scale: 1, alpha: 1 }], appearance);
		const first = host.querySelector(".graph-insight-label");
		overlay.sync([{ id: "folder", text: "Renamed", x: 1, y: 2, scale: 1, alpha: 1 }], appearance);

		expect(host.querySelectorAll(".graph-insight-label")).toHaveLength(1);
		expect(host.querySelector(".graph-insight-label")).toBe(first);
		expect(first?.textContent).toBe("Renamed");

		overlay.sync([], appearance);
		expect(host.querySelectorAll(".graph-insight-label")).toHaveLength(0);
		overlay.destroy();
		expect(host.querySelector(".graph-insight-label-layer")).toBeNull();
	});

	test("snaps positions to the Retina physical-pixel grid", () => {
		const descriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
		Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
		try {
			const host = document.body.createDiv();
			const overlay = new LabelOverlay(host);
			overlay.sync([{ id: 1, text: "Retina", x: 10.26, y: 20.24, scale: 1, alpha: 1 }], {
				fontFamily: "sans-serif", fontSize: 11, fill: "#fff", halo: "#000",
			});

			const label = host.querySelector<HTMLElement>(".graph-insight-label");
			expect(label?.style.left).toBe("10.5px");
			expect(label?.style.top).toBe("20px");
		} finally {
			if (descriptor) Object.defineProperty(window, "devicePixelRatio", descriptor);
			else Reflect.deleteProperty(window, "devicePixelRatio");
		}
	});
});
