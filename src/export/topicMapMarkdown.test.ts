import { beforeAll, describe, expect, test } from "vitest";
import { initI18n } from "../i18n";
import { nextAvailableName, topicMapMarkdown, type TopicMapOptions } from "./topicMapMarkdown";
import { buildNeighborhood } from "../analysis/neighborhood";
import type { GraphModel } from "../data/GraphStore";

beforeAll(() => initI18n("en"));

/** a → b → c, a → d; e isolated. */
const model: GraphModel = {
	nodes: ["a", "b", "c", "d", "e"].map((name, id) => ({
		id,
		path: `${name}.md`,
		name,
		inCount: 0,
		outCount: 0,
		unresolvedCount: 0,
	})),
	edges: [
		{ source: 0, target: 1, weight: 1 },
		{ source: 1, target: 2, weight: 1 },
		{ source: 0, target: 3, weight: 1 },
	],
	pathToId: new Map([["a.md", 0], ["b.md", 1], ["c.md", 2], ["d.md", 3], ["e.md", 4]]),
};

const options = (overrides: Partial<TopicMapOptions> = {}): TopicMapOptions => ({
	source: "focus",
	generatedAt: "2026-08-17T00:00:00Z",
	includeDirections: true,
	includeMetrics: true,
	includeInternalLinks: true,
	locale: "en",
	...overrides,
});

describe("topicMapMarkdown (F-12)", () => {
	test("a rooted map is deterministic and carries frontmatter, levels and links", () => {
		const neighborhood = buildNeighborhood(model, 0, 2);
		const body = topicMapMarkdown({ kind: "rooted", neighborhood }, options());
		expect(body).toBe(topicMapMarkdown({ kind: "rooted", neighborhood }, options()));
		expect(body).toContain("advanced-graph-view: topic-map");
		expect(body).toContain("source: focus");
		expect(body).toContain("depth: 2");
		expect(body).toContain("# Topic map: [[a]]");
		expect(body).toContain("- Notes: 4");
		expect(body).toContain("- Links inside the selection: 3");
		expect(body).toContain("## Level 1");
		expect(body).toContain("- → [[b]]");
		expect(body).toContain("- [[c]] (via [[b]])");
		expect(body).toContain("- [[a]] → [[b]]");
	});

	test("directions can be turned off", () => {
		const neighborhood = buildNeighborhood(model, 0, 1);
		const body = topicMapMarkdown(
			{ kind: "rooted", neighborhood },
			options({ includeDirections: false, includeInternalLinks: false })
		);
		expect(body).toContain("- [[b]]");
		expect(body).not.toContain("→ [[b]]");
	});

	test("a flat lasso map lists notes alphabetically without level sections", () => {
		const body = topicMapMarkdown(
			{ kind: "flat", model, nodeIds: [3, 0, 1] },
			options({ source: "lasso" })
		);
		expect(body).toContain("source: lasso");
		expect(body).not.toContain("Level 1");
		expect(body.indexOf("[[a]]")).toBeLessThan(body.indexOf("[[b]]"));
		expect(body).toContain("- Links inside the selection: 2");
	});

	test("metrics rank the busiest notes inside the selection", () => {
		const body = topicMapMarkdown(
			{ kind: "flat", model, nodeIds: [0, 1, 2, 3] },
			options({ source: "cluster" })
		);
		expect(body).toContain("## Central notes");
		const central = body.split("## Central notes")[1].split("##")[0];
		expect(central.indexOf("[[a]]")).toBeLessThan(central.indexOf("[[c]]"));
	});
});

describe("nextAvailableName", () => {
	test("keeps a free name and numbers a taken one before the extension", () => {
		expect(nextAvailableName("Map.md", () => false)).toBe("Map.md");
		const taken = new Set(["Map.md", "Map 1.md"]);
		expect(nextAvailableName("Map.md", (name) => taken.has(name))).toBe("Map 2.md");
	});
});
