import { describe, expect, test } from "vitest";
import { chooseCompanionAction } from "./companionPane";

describe("chooseCompanionAction", () => {
	const graphLeaf = { id: "graph" };
	const companion = { id: "companion" };

	test("creates a pane when none has been opened yet", () => {
		expect(chooseCompanionAction(null, [graphLeaf], graphLeaf)).toBe("create");
	});

	test("reuses the pane while it is still open", () => {
		expect(chooseCompanionAction(companion, [graphLeaf, companion], graphLeaf)).toBe("reuse");
	});

	test("creates a new pane after the old one was closed", () => {
		expect(chooseCompanionAction(companion, [graphLeaf], graphLeaf)).toBe("create");
	});

	test("never reuses the graph's own pane, which would hide the graph", () => {
		expect(chooseCompanionAction(graphLeaf, [graphLeaf], graphLeaf)).toBe("create");
	});
});
