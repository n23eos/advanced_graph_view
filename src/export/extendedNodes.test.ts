import { nodeMarkdown } from "../data/graphNodes";
import { expect, test } from "vitest";
import { buildGraphModel } from "../data/GraphStore";
import { buildNeighborhood } from "../analysis/neighborhood";
import { localGraphMarkdown } from "./localGraphMarkdown";
import { topicMapMarkdown } from "./topicMapMarkdown";
import { graphToJson, graphToGexf } from "./exporters";
import { computeOverlayMask } from "../analysis/overlays";
const model = buildGraphModel(["a.md"], { "a.md": { "folder/image.png": 1 } }, { "a.md": { Ghost: 1 } }, {
	scope: { attachments: true, unresolved: true }, attachmentPaths: ["folder/image.png"], sourcePaths: new Set(["a.md"]),
});
test("Markdown preserves attachment paths and missing-source context without invented links", () => {
	const neighborhood = buildNeighborhood(model, 0, 2);
	const outputs = [localGraphMarkdown(neighborhood), topicMapMarkdown({ kind: "rooted", neighborhood }, {
		source: "focus", generatedAt: "now", includeDirections: true, includeMetrics: true, includeInternalLinks: true,
	})];
	for (const output of outputs) {
		expect(output).toContain("[[folder/image.png]]");
		expect(output).toContain("[[a.md]]");
		expect(output).not.toContain("[[Ghost]]");
		expect(output).not.toContain("\0");
	}
	expect(neighborhood.model.scope).toEqual(model.scope);
});
test("machine exports distinguish missing targets and attachment kinds", () => {
	const json = JSON.parse(graphToJson(model)) as { nodes: Array<{ kind: string }> };
	expect(json.nodes.find((n: { kind: string }) => n.kind === "unresolved")).toMatchObject({ path: null, linkpath: "Ghost", sourcePath: "a.md" });
	expect(graphToGexf(model)).toContain('value="attachment"');
});
test("note-oriented overlays do not flag every attachment and missing node as a dead end", () => {
	expect([...computeOverlayMask(model, { orphans: false, broken: false, deadEnds: true })!]).toEqual([0, 0, 0]);
});

test("legacy linked attachments retain full paths in links and local root titles", () => {
	const legacy = buildGraphModel(["a.md"], { "a.md": { "folder/image.png": 1 } }, {});
	expect(nodeMarkdown(legacy.nodes[1])).toBe("[[folder/image.png]]");
	expect(nodeMarkdown(legacy.nodes[0])).toBe("[[a]]");
	const text = localGraphMarkdown(buildNeighborhood(legacy, legacy.pathToId.get("folder/image.png")!, 1));
	expect(text.split("\n")[0]).toContain("[[folder/image.png]]");
	expect(text).not.toContain("[[image]]");
	expect(text).toContain("[[a]]");
	const extended = localGraphMarkdown(buildNeighborhood(model, model.pathToId.get("folder/image.png")!, 1));
	expect(extended.split("\n")[0]).toContain("[[folder/image.png]]");
	expect(extended).not.toContain("[[[[");
});
test("mixed topic maps label nodes while legacy note-only maps retain their labels", () => {
	const options = { source: "lasso" as const, generatedAt: "now", includeDirections: true, includeMetrics: true, includeInternalLinks: true };
	const mixed = topicMapMarkdown({ kind: "flat", model, nodeIds: [0, 1, 2] }, options);
	expect(mixed).toContain("Topic map: 3 nodes");
	expect(mixed).toContain("## Central nodes");
	expect(mixed).toContain("## Nodes");
	const legacy = buildGraphModel(["a.md"], {}, {});
	const original = topicMapMarkdown({ kind: "flat", model: legacy, nodeIds: [0] }, options);
	expect(original).toContain("Topic map: 1 notes");
	expect(original).toContain("## Central notes");
	expect(original).toContain("## Notes");
});
