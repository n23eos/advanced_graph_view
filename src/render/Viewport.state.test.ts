// @vitest-environment jsdom
import { Container } from "pixi.js";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ViewportState } from "../view/workspaceState";
import { installObsidianDom } from "../test/obsidianDom";
import { Viewport } from "./Viewport";

const saved: ViewportState = {
	centerX: 125,
	centerY: -40,
	scale: 1.75,
	referenceScale: 0.6,
};

beforeAll(() => installObsidianDom());

describe("Viewport workspace state", () => {
	test("round-trips a world center across different screen dimensions without reporting user input", () => {
		const firstWorld = new Container();
		const firstChanged = vi.fn();
		const first = new Viewport(firstWorld, document.body.createEl("canvas"), firstChanged);
		const secondWorld = new Container();
		const secondChanged = vi.fn();
		const second = new Viewport(secondWorld, document.body.createEl("canvas"), secondChanged);

		try {
			first.restoreState(saved, 800, 600);
			expect(firstChanged).not.toHaveBeenCalled();
			expect(first.getState(800, 600)).toEqual(saved);

			second.restoreState(first.getState(800, 600), 1200, 900);
			expect(secondChanged).not.toHaveBeenCalled();
			expect(second.toWorld(600, 450)).toEqual({ x: 125, y: -40 });
			expect(second.scale).toBe(1.75);
			expect(second.referenceScale).toBe(0.6);
		} finally {
			first.destroy();
			second.destroy();
			firstWorld.destroy();
			secondWorld.destroy();
		}
	});
});
