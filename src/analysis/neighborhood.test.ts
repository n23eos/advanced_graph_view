import { describe, expect, it } from "vitest";
import { buildGraphModel } from "../data/GraphStore";
import { buildNeighborhood } from "./neighborhood";

/** A.md → B.md → C.md → D.md, A.md → E.md, X.md → Y.md (disconnected). */
function fixtureModel() {
	const files = ["A.md", "B.md", "C.md", "D.md", "E.md", "X.md", "Y.md"];
	const resolved = {
		"A.md": { "B.md": 1, "E.md": 1 },
		"B.md": { "C.md": 1 },
		"C.md": { "D.md": 1 },
		"X.md": { "Y.md": 1 },
	};
	return buildGraphModel(files, resolved, {});
}

const idOf = (sub: ReturnType<typeof buildNeighborhood>, name: string) => {
	const node = sub.model.nodes.find((n) => n.name === name);
	expect(node, name).toBeDefined();
	return node!.id;
};

describe("buildNeighborhood", () => {
	it("keeps only nodes within the requested depth", () => {
		const model = fixtureModel();
		const sub = buildNeighborhood(model, model.pathToId.get("A.md")!, 2);

		expect(sub.model.nodes.map((n) => n.name).sort()).toEqual(["A", "B", "C", "E"]);
	});

	it("places the root at depth 0 and rings at their hop count", () => {
		const model = fixtureModel();
		const sub = buildNeighborhood(model, model.pathToId.get("A.md")!, 2);

		expect(sub.depths[sub.rootId]).toBe(0);
		expect(sub.depths[idOf(sub, "B")]).toBe(1);
		expect(sub.depths[idOf(sub, "E")]).toBe(1);
		expect(sub.depths[idOf(sub, "C")]).toBe(2);
	});

	it("records the BFS parent so export can say how a note was reached", () => {
		const model = fixtureModel();
		const sub = buildNeighborhood(model, model.pathToId.get("A.md")!, 2);

		expect(sub.parents[sub.rootId]).toBe(-1);
		expect(sub.parents[idOf(sub, "C")]).toBe(idOf(sub, "B"));
	});

	it("keeps only edges whose both ends are inside the neighborhood", () => {
		const model = fixtureModel();
		const sub = buildNeighborhood(model, model.pathToId.get("A.md")!, 2);

		const pairs = sub.model.edges
			.map((e) => [sub.model.nodes[e.source].name, sub.model.nodes[e.target].name].sort().join("-"))
			.sort();
		expect(pairs).toEqual(["A-B", "A-E", "B-C"]);
	});

	it("reaches the root through inbound links too — the graph is undirected", () => {
		const model = fixtureModel();
		const sub = buildNeighborhood(model, model.pathToId.get("B.md")!, 1);

		expect(sub.model.nodes.map((n) => n.name).sort()).toEqual(["A", "B", "C"]);
	});

	it("rebuilds pathToId for the renumbered subgraph", () => {
		const model = fixtureModel();
		const sub = buildNeighborhood(model, model.pathToId.get("A.md")!, 1);

		for (const node of sub.model.nodes) {
			expect(sub.model.pathToId.get(node.path)).toBe(node.id);
		}
	});

	it("maps every subgraph node back to its original id", () => {
		const model = fixtureModel();
		const sub = buildNeighborhood(model, model.pathToId.get("A.md")!, 2);

		for (const node of sub.model.nodes) {
			expect(model.nodes[sub.toOriginal[node.id]].path).toBe(node.path);
		}
	});
});
