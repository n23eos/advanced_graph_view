import { describe, expect, test } from "vitest";
import { graphToJson, graphToGexf } from "./exporters";
import { buildGraphModel } from "../data/GraphStore";

const model = buildGraphModel(
	["a.md", "b & c.md"],
	{ "a.md": { "b & c.md": 2 } },
	{}
);

describe("graphToJson", () => {
	test("round-trippable structure with nodes and edges", () => {
		// Act
		const parsed = JSON.parse(graphToJson(model));

		// Assert
		expect(parsed.nodes).toHaveLength(2);
		expect(parsed.edges).toEqual([{ source: "a.md", target: "b & c.md", weight: 2 }]);
	});
});

describe("graphToGexf", () => {
	test("valid gexf skeleton with escaped labels", () => {
		// Act
		const xml = graphToGexf(model);

		// Assert
		expect(xml).toContain("<gexf");
		expect(xml).toContain('label="b &amp; c"'); // XML-escaped
		expect(xml).toContain('<edge id="0" source="0" target="1" weight="2"');
	});
});
