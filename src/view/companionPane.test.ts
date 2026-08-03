import { describe, expect, test } from "vitest";
import { chooseCompanionAction } from "./companionPane";

describe("chooseCompanionAction", () => {
	test("creates a pane when none has been opened yet", () => {
		expect(chooseCompanionAction(null, ["graph"], "graph")).toBe("create");
	});

	test("reuses the pane while it is still open", () => {
		expect(chooseCompanionAction("companion", ["graph", "companion"], "graph")).toBe("reuse");
	});

	test("creates a new pane after the old one was closed", () => {
		expect(chooseCompanionAction("companion", ["graph"], "graph")).toBe("create");
	});

	test("never reuses the graph's own pane, which would hide the graph", () => {
		expect(chooseCompanionAction("graph", ["graph"], "graph")).toBe("create");
	});

	test("reuses by id even when the workspace rebuilt the leaf object", () => {
		// Obsidian can recreate the WorkspaceLeaf behind the same id; identity
		// comparison used to answer "create" here and pile up panes.
		const rebuiltWorkspaceIds = ["graph", "companion"];

		expect(chooseCompanionAction("companion", rebuiltWorkspaceIds, "graph")).toBe("reuse");
	});
});
