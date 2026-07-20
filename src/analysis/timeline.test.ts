import { describe, expect, test } from "vitest";
import { buildMonthHistogram, monthIndexToCutoff } from "./timeline";

const ts = (iso: string) => new Date(iso).getTime();

describe("buildMonthHistogram", () => {
	test("buckets note timestamps per month across the full range", () => {
		// Arrange
		const times = [ts("2026-01-15"), ts("2026-01-20"), ts("2026-03-05")];

		// Act
		const hist = buildMonthHistogram(times);

		// Assert: Jan, Feb, Mar → 3 buckets
		expect(hist.counts).toEqual([2, 0, 1]);
		expect(hist.startYear).toBe(2026);
		expect(hist.startMonth).toBe(0);
	});

	test("empty input yields empty histogram", () => {
		expect(buildMonthHistogram([]).counts).toEqual([]);
	});
});

describe("monthIndexToCutoff", () => {
	test("index maps to the END of that month", () => {
		// Arrange
		const hist = buildMonthHistogram([ts("2026-01-15"), ts("2026-03-05")]);

		// Act: index 0 = end of Jan 2026
		const cutoff = monthIndexToCutoff(hist, 0);

		// Assert
		expect(new Date(cutoff).getUTCMonth()).toBe(1); // Feb 1 = end of Jan
		expect(ts("2026-01-15")).toBeLessThan(cutoff);
		expect(ts("2026-03-05")).toBeGreaterThan(cutoff);
	});

	test("last index covers every note", () => {
		const times = [ts("2026-01-15"), ts("2026-03-05")];
		const hist = buildMonthHistogram(times);
		const cutoff = monthIndexToCutoff(hist, hist.counts.length - 1);
		expect(times.every((t) => t < cutoff)).toBe(true);
	});
});
