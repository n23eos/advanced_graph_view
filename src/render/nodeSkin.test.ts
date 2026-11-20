import { describe, expect, test } from "vitest";
import { nodeSkinForScheme } from "./nodeSkin";

describe("node material skins", () => {
	test("gives the expressive schemes distinct silhouettes", () => {
		expect(nodeSkinForScheme("galaxy")).toBe("star");
		expect(nodeSkinForScheme("nebula")).toBe("nebula");
		expect(nodeSkinForScheme("neon")).toBe("neon");
	});

	test("covers every built-in scheme and safely falls back", () => {
		const skins = ["recency", "heat", "mono", "galaxy", "nebula", "neon", "solar", "pastel"]
			.map(nodeSkinForScheme);
		expect(new Set(skins).size).toBe(skins.length);
		expect(nodeSkinForScheme("future-scheme")).toBe("classic");
	});
});
