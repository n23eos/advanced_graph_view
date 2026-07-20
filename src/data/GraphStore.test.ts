import { describe, expect, test } from "vitest";
import { buildGraphModel } from "./GraphStore";

const NO_LINKS = {};

describe("buildGraphModel", () => {
	test("creates a node for every vault file, including isolated ones", () => {
		// Arrange
		const files = ["a.md", "b.md", "lonely.md"];
		const resolved = { "a.md": { "b.md": 1 } };

		// Act
		const model = buildGraphModel(files, resolved, NO_LINKS);

		// Assert
		expect(model.nodes.map((n) => n.path).sort()).toEqual(["a.md", "b.md", "lonely.md"]);
	});

	test("derives node name from basename without extension", () => {
		// Arrange
		const files = ["folder/deep/My Note.md"];

		// Act
		const model = buildGraphModel(files, NO_LINKS, NO_LINKS);

		// Assert
		expect(model.nodes[0].name).toBe("My Note");
	});

	test("creates edges with weight equal to link count", () => {
		// Arrange
		const files = ["a.md", "b.md"];
		const resolved = { "a.md": { "b.md": 3 } };

		// Act
		const model = buildGraphModel(files, resolved, NO_LINKS);

		// Assert
		expect(model.edges).toHaveLength(1);
		const edge = model.edges[0];
		expect(model.nodes[edge.source].path).toBe("a.md");
		expect(model.nodes[edge.target].path).toBe("b.md");
		expect(edge.weight).toBe(3);
	});

	test("counts inbound and outbound links per node", () => {
		// Arrange
		const files = ["hub.md", "x.md", "y.md"];
		const resolved = {
			"hub.md": { "x.md": 1, "y.md": 2 },
			"x.md": { "hub.md": 1 },
		};

		// Act
		const model = buildGraphModel(files, resolved, NO_LINKS);
		const byPath = new Map(model.nodes.map((n) => [n.path, n]));

		// Assert
		expect(byPath.get("hub.md")).toMatchObject({ outCount: 2, inCount: 1 });
		expect(byPath.get("x.md")).toMatchObject({ outCount: 1, inCount: 1 });
		expect(byPath.get("y.md")).toMatchObject({ outCount: 0, inCount: 1 });
	});

	test("includes link targets missing from the file list (e.g. attachments)", () => {
		// Arrange
		const files = ["a.md"];
		const resolved = { "a.md": { "image.png": 1 } };

		// Act
		const model = buildGraphModel(files, resolved, NO_LINKS);

		// Assert
		expect(model.nodes.map((n) => n.path).sort()).toEqual(["a.md", "image.png"]);
	});

	test("ignores self-links", () => {
		// Arrange
		const files = ["a.md"];
		const resolved = { "a.md": { "a.md": 5 } };

		// Act
		const model = buildGraphModel(files, resolved, NO_LINKS);

		// Assert
		expect(model.edges).toHaveLength(0);
		expect(model.nodes[0].inCount).toBe(0);
		expect(model.nodes[0].outCount).toBe(0);
	});

	test("stores unresolved link count per source node without creating edges", () => {
		// Arrange
		const files = ["a.md", "b.md"];
		const unresolved = { "a.md": { "Ghost Note": 2 } };

		// Act
		const model = buildGraphModel(files, NO_LINKS, unresolved);
		const byPath = new Map(model.nodes.map((n) => [n.path, n]));

		// Assert
		expect(byPath.get("a.md")?.unresolvedCount).toBe(2);
		expect(byPath.get("b.md")?.unresolvedCount).toBe(0);
		expect(model.edges).toHaveLength(0);
	});

	test("returns an index lookup from path to node id", () => {
		// Arrange
		const files = ["a.md", "b.md"];

		// Act
		const model = buildGraphModel(files, NO_LINKS, NO_LINKS);

		// Assert
		for (const node of model.nodes) {
			expect(model.pathToId.get(node.path)).toBe(node.id);
		}
	});
});
