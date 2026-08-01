/**
 * mulberry32 — a small seeded pseudo-random generator.
 *
 * Used wherever randomness must not leak into the result: clustering has to
 * give the same answer for the same vault, and benchmarks have to measure the
 * same graph on every run. Any decent seeded generator would do; the only
 * requirement is that it never reads the clock.
 */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
