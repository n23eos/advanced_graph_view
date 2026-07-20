import { describe, expect, test } from "vitest";
import { nameClusters } from "./clusterNames";

describe("nameClusters", () => {
	test("picks distinctive terms per cluster, not shared ones", () => {
		// Arrange: "заметки" appears everywhere → low idf, must not dominate
		const clusters = [
			{ titles: ["Заметки про кулинарию", "Рецепты пасты", "Кулинария Италии"], tags: [] },
			{ titles: ["Заметки про Python", "Python скрипты", "Скрипты автоматизации"], tags: [] },
		];

		// Act
		const names = nameClusters(clusters);

		// Assert
		expect(names[0].toLowerCase()).toContain("кулинар");
		expect(names[1].toLowerCase()).toContain("python");
		expect(names[0].toLowerCase()).not.toContain("python");
	});

	test("prepends the dominant tag when present", () => {
		// Arrange
		const clusters = [
			{ titles: ["Один", "Два"], tags: ["work", "work", "idea"] },
		];

		// Act
		const names = nameClusters(clusters);

		// Assert
		expect(names[0]).toContain("#work");
	});

	test("empty cluster falls back to a placeholder", () => {
		expect(nameClusters([{ titles: [], tags: [] }])[0]).toBeTruthy();
	});

	test("short and stop words are ignored", () => {
		// Arrange
		const clusters = [
			{ titles: ["и в на о же про для как"], tags: [] },
			{ titles: ["Грибы леса"], tags: [] },
		];

		// Act
		const names = nameClusters(clusters);

		// Assert: cluster of stop words only gets the fallback, not junk terms
		expect(names[0].toLowerCase()).not.toMatch(/\bи\b|\bв\b|\bна\b/);
	});
});
