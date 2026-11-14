// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from "vitest";
import { Container } from "pixi.js";
import { Viewport } from "./Viewport";
import { installObsidianDom } from "../test/obsidianDom";

beforeAll(() => installObsidianDom());
afterEach(() => document.body.empty());

test("pan tracks the canvas window outside its bounds and detaches from that window after migration", () => {
	const frame = document.body.createEl("iframe");
	const ownerWindow = frame.contentWindow!;
	const canvas = document.body.createEl("canvas");
	ownerWindow.document.body.appendChild(canvas);
	const world = new Container();
	const viewport = new Viewport(world, canvas, () => {});
	try {
		canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 10, clientY: 20 }));
		window.dispatchEvent(new MouseEvent("pointermove", { clientX: 900, clientY: 700 }));
		expect(world.position.x).toBe(0);
		ownerWindow.dispatchEvent(new MouseEvent("pointermove", { clientX: 900, clientY: 700 }));
		expect(world.position.x).toBe(890);
		expect(world.position.y).toBe(680);
		document.body.appendChild(canvas);
		viewport.destroy();
		ownerWindow.dispatchEvent(new MouseEvent("pointermove", { clientX: 1000, clientY: 800 }));
		expect(world.position.x).toBe(890);
	} finally { viewport.destroy(); }
});
