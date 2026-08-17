import { describe, expect, test } from "vitest";
import { responsiveMode } from "./responsive";

describe("responsiveMode (F-04)", () => {
	test("maps the spec's test widths to the right modes", () => {
		expect(responsiveMode(480)).toBe("minimal");
		expect(responsiveMode(600)).toBe("compact");
		expect(responsiveMode(768)).toBe("compact");
		expect(responsiveMode(900)).toBe("full");
		expect(responsiveMode(1200)).toBe("full");
	});

	test("boundaries sit exactly at 600 and 900", () => {
		expect(responsiveMode(599)).toBe("minimal");
		expect(responsiveMode(899)).toBe("compact");
	});
});
