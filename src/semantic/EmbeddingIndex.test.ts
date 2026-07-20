import { describe, expect, test } from "vitest";
import { EmbeddingIndex } from "./EmbeddingIndex";

const DIM = 4;

function vec(...values: number[]): Float32Array {
	return new Float32Array(values);
}

describe("EmbeddingIndex", () => {
	test("set and get roundtrip", () => {
		// Arrange
		const index = new EmbeddingIndex(DIM);

		// Act
		index.set("a.md", 111, vec(1, 0, 0, 0));

		// Assert
		expect(Array.from(index.getVector("a.md")!)).toEqual([1, 0, 0, 0]);
		expect(index.getHash("a.md")).toBe(111);
	});

	test("set overwrites existing entry in place", () => {
		const index = new EmbeddingIndex(DIM);
		index.set("a.md", 1, vec(1, 0, 0, 0));
		index.set("a.md", 2, vec(0, 1, 0, 0));
		expect(index.size).toBe(1);
		expect(Array.from(index.getVector("a.md")!)).toEqual([0, 1, 0, 0]);
	});

	test("remove and rename keep data consistent", () => {
		const index = new EmbeddingIndex(DIM);
		index.set("a.md", 1, vec(1, 0, 0, 0));
		index.set("b.md", 2, vec(0, 1, 0, 0));

		index.rename("a.md", "c.md");
		index.remove("b.md");

		expect(index.getVector("c.md")).toBeTruthy();
		expect(index.getVector("a.md")).toBeNull();
		expect(index.getVector("b.md")).toBeNull();
		expect(index.size).toBe(1);
	});

	test("serialize/deserialize binary roundtrip", () => {
		// Arrange
		const index = new EmbeddingIndex(DIM);
		index.set("a.md", 7, vec(0.5, -1, 2, 0));
		index.set("b.md", 8, vec(1, 1, 1, 1));

		// Act
		const { meta, vectors } = index.serialize();
		const restored = EmbeddingIndex.deserialize(meta, vectors);

		// Assert
		expect(restored.size).toBe(2);
		expect(restored.getHash("a.md")).toBe(7);
		expect(Array.from(restored.getVector("b.md")!)).toEqual([1, 1, 1, 1]);
	});

	test("packAll returns contiguous matrix with matching path order", () => {
		const index = new EmbeddingIndex(DIM);
		index.set("a.md", 1, vec(1, 0, 0, 0));
		index.set("b.md", 2, vec(0, 1, 0, 0));

		const { paths, matrix } = index.packAll();
		const aOffset = paths.indexOf("a.md") * DIM;
		expect(matrix[aOffset]).toBe(1);
		expect(matrix.length).toBe(2 * DIM);
	});
});
