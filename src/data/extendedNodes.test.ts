import { describe, expect, test } from "vitest";
import { buildGraphModel } from "./GraphStore";
import { normalizeSettings } from "../settings/normalize";
import { computeGraphMetrics } from "../workers/metricsEngine";

const links = { "a.md": { "linked.png": 2 } };
const missing = { "a.md": { Ghost: 2 }, "b.md": { Ghost: 1 }, "deleted.md": { Nope: 1 } };
const options = (attachments: boolean, unresolved: boolean) => ({
	scope: { attachments, unresolved }, attachmentPaths: ["linked.png", "alone.pdf"],
	sourcePaths: new Set(["a.md", "b.md"]),
});

describe("extended graph membership", () => {
	test("explicit off/off is exactly the legacy model including stale cache and linked attachments", () => {
		expect(buildGraphModel(["a.md", "b.md"], links, missing, options(false, false)))
			.toEqual(buildGraphModel(["a.md", "b.md"], links, missing));
	});
	test.each([[true, false], [false, true], [true, true]])("adds only requested membership %s/%s", (attachments, unresolved) => {
		const model = buildGraphModel(["a.md", "b.md"], links, missing, options(attachments, unresolved));
		expect(model.pathToId.has("alone.pdf")).toBe(attachments);
		expect(model.nodes.filter(n => n.kind === "unresolved")).toHaveLength(unresolved ? 2 : 0);
		expect(model.nodes.map(n => n.id)).toEqual(model.nodes.map((_, i) => i));
		expect(new Set(model.nodes.map(n => n.path)).size).toBe(model.nodes.length);
		for (const e of model.edges) { expect(model.nodes[e.source]).toBeDefined(); expect(model.nodes[e.target]).toBeDefined(); }
		const metrics = computeGraphMetrics(model.nodes.length, Uint32Array.from(model.edges.flatMap(e => [e.source, e.target])), Float32Array.from(model.edges.map(e => e.weight)));
		expect([...metrics.pagerank].every(Number.isFinite)).toBe(true);
	});
	test("a now-resolved missing destination reuses its real node and never duplicates a resolved edge", () => {
		const model = buildGraphModel(["a.md"], links, { "a.md": { old: 2 } }, {
			...options(false, true), resolveTarget: () => "linked.png",
		});
		expect(model.nodes.filter(n => n.kind === "unresolved")).toHaveLength(0);
		expect(model.edges).toHaveLength(1);
		expect(model.edges[0].weight).toBe(2);
	});
	test("new scopes normalize strictly and default off", () => {
		expect(normalizeSettings({}).graphScope).toEqual({ attachments: false, unresolved: false });
		expect(normalizeSettings({ graphScope: { attachments: "yes", unresolved: true } }).graphScope)
			.toEqual({ attachments: false, unresolved: true });
	});
});

test("multiple stale aliases resolved to one new destination aggregate without duplicate edges", () => {
	const model = buildGraphModel(["a.md"], {}, { "a.md": { old: 2, alias: 3 } }, {
		...options(false, true), resolveTarget: () => "linked.png",
	});
	expect(model.edges).toHaveLength(1);
	expect(model.edges[0].weight).toBe(5);
	expect(model.nodes[0].outCount).toBe(1);
});
