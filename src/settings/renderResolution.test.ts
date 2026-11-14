import { describe, expect, test } from "vitest";
import { renderResolution } from "./renderResolution";

describe("render resolution", () => {
	test("keeps standard rendering at one CSS pixel per render pixel", () => {
		expect(renderResolution("standard", 2)).toEqual({ resolution: 1, autoDensity: false });
	});

	test("uses the device pixel ratio for high resolution", () => {
		expect(renderResolution("high", 1.5)).toEqual({ resolution: 1.5, autoDensity: true });
	});

	test("caps high resolution at two render pixels per CSS pixel", () => {
		expect(renderResolution("high", 3)).toEqual({ resolution: 2, autoDensity: true });
	});
});
