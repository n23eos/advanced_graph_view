import { describe, expect, test } from "vitest";
import { normalizeGraphViewState } from "./workspaceState";

const camera = {
	viewport: { centerX: 12, centerY: -8, scale: 1.5, referenceScale: 0.75 },
	camera3d: {
		position: { x: 10, y: 20, z: -300 },
		pivot: { x: 1, y: 2, z: 3 },
		yaw: 0.4,
		pitch: -0.2,
	},
};

describe("workspace graph state normalization", () => {
	test("accepts a complete finite camera and a valid committed query", () => {
		expect(normalizeGraphViewState({ version: 1, camera, hardQuery: "content:needle tag:#work" })).toEqual({
			version: 1,
			camera,
			hardQuery: "content:needle tag:#work",
		});
	});

	test.each([
		null,
		[],
		{ version: 2, camera, hardQuery: "tag:#work" },
		{ version: "1", camera, hardQuery: "tag:#work" },
	])("ignores unsupported top-level state %#", (state) => {
		expect(normalizeGraphViewState(state)).toBeNull();
	});

	test.each([
		{ ...camera, viewport: { ...camera.viewport, centerX: Number.NaN } },
		{ ...camera, viewport: { ...camera.viewport, scale: 0 } },
		{ ...camera, viewport: { ...camera.viewport, referenceScale: 9 } },
		{ ...camera, camera3d: { ...camera.camera3d, pitch: 1.5 } },
		{ ...camera, camera3d: { ...camera.camera3d, pivot: { x: 0, y: Infinity, z: 0 } } },
		{ ...camera, camera3d: { ...camera.camera3d, position: { x: 0, y: 0 } } },
	])("drops an invalid camera atomically while retaining an independent query %#", (invalidCamera) => {
		expect(normalizeGraphViewState({ version: 1, camera: invalidCamera, hardQuery: "tag:#work" })).toEqual({
			version: 1,
			hardQuery: "tag:#work",
		});
	});

	test("drops a malformed query while retaining an independent camera", () => {
		expect(normalizeGraphViewState({ version: 1, camera, hardQuery: "links:not-a-number" })).toEqual({
			version: 1,
			camera,
		});
	});

	test("keeps an empty query as an explicit filter clear", () => {
		expect(normalizeGraphViewState({ version: 1, hardQuery: "" })).toEqual({
			version: 1,
			hardQuery: "",
		});
	});
});
