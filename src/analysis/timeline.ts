/** Month histogram for the timeline slider sparkline. */

export interface MonthHistogram {
	/** Notes per month, starting at startYear/startMonth. */
	counts: number[];
	startYear: number;
	/** 0-based month. */
	startMonth: number;
}

export function buildMonthHistogram(timestamps: readonly number[]): MonthHistogram {
	if (timestamps.length === 0) return { counts: [], startYear: 0, startMonth: 0 };

	let min = Infinity;
	let max = -Infinity;
	for (const ts of timestamps) {
		if (ts < min) min = ts;
		if (ts > max) max = ts;
	}
	const start = new Date(min);
	const end = new Date(max);
	const startYear = start.getUTCFullYear();
	const startMonth = start.getUTCMonth();
	const monthCount =
		(end.getUTCFullYear() - startYear) * 12 + (end.getUTCMonth() - startMonth) + 1;

	const counts = new Array<number>(monthCount).fill(0);
	for (const ts of timestamps) {
		const date = new Date(ts);
		const index = (date.getUTCFullYear() - startYear) * 12 + (date.getUTCMonth() - startMonth);
		counts[index]++;
	}
	return { counts, startYear, startMonth };
}

/** Cutoff timestamp = first instant AFTER the month at `index`. */
export function monthIndexToCutoff(histogram: MonthHistogram, index: number): number {
	const totalMonths = histogram.startMonth + index + 1;
	return Date.UTC(histogram.startYear + Math.floor(totalMonths / 12), totalMonths % 12, 1);
}

export function monthIndexLabel(histogram: MonthHistogram, index: number): string {
	const totalMonths = histogram.startMonth + index;
	const year = histogram.startYear + Math.floor(totalMonths / 12);
	const month = (totalMonths % 12) + 1;
	return `${String(month).padStart(2, "0")}.${year}`;
}
