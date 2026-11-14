import { describe, expect, test } from "vitest";
import { collectPropertyKeys, normalizeFrontmatterProperties } from "./frontmatterProperties";
import type { NodeFacts } from "./metrics";

function facts(properties?: NodeFacts["properties"]): NodeFacts {
	return {
		path: "a.md", folder: "", tags: [], inCount: 0, outCount: 0, unresolvedCount: 0,
		ctime: 0, mtime: 0, size: 0, opensTotal: 0, pagerank: 0, cluster: "",
		opens7: 0, opens30: 0, opens90: 0, properties,
	};
}

describe("frontmatter property normalization", () => {
	test("keeps supported scalars and list items while ignoring host metadata and objects", () => {
		const result = normalizeFrontmatterProperties({
			" Status ": " Active ",
			priority: 0,
			published: false,
			list: ["One", 2, false, null, {}, ["nested"], " "],
			empty: " ",
			notFinite: Number.POSITIVE_INFINITY,
			position: { start: 0, end: 10 },
			object: { value: "ignored" },
		});

		expect(result).toEqual({
			status: ["Active"],
			priority: ["0"],
			published: ["false"],
			list: ["One", "2", "false"],
		});
	});

	test("stores prototype-related keys as ordinary own data", () => {
		const raw = JSON.parse('{"__proto__":"safe","constructor":"also-safe"}') as Record<string, unknown>;
		const result = normalizeFrontmatterProperties(raw)!;
		expect(Object.getPrototypeOf(result)).toBeNull();
		expect(result["__proto__"]).toEqual(["safe"]);
		expect(result.constructor).toEqual(["also-safe"]);
	});

	test("returns undefined when no usable property remains", () => {
		expect(normalizeFrontmatterProperties(undefined)).toBeUndefined();
		expect(normalizeFrontmatterProperties({ position: {}, empty: null })).toBeUndefined();
	});
});

describe("property key discovery", () => {
	test("sorts by note frequency then name and retains an absent active key", () => {
		const rows = [
			facts({ status: ["active"], team: ["core"] }),
			facts({ status: ["done"], priority: ["1"] }),
			facts({ team: ["docs"] }),
		];
		expect(collectPropertyKeys(rows, "prop:missing")).toEqual(["status", "team", "priority", "missing"]);
	});
});
