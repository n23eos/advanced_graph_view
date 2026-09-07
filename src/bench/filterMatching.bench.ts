import { bench, describe } from "vitest";
import { compileChipFilter } from "../ui/chipFilter";

for (const count of [3_000, 10_000, 50_000]) {
	const facts = Array.from({ length: count }, (_, i) => ({
		tags: i % 7 === 0 ? ["work/client", `topic/${i % 31}`] : [`topic/${i % 31}`],
		folder: i % 5 === 0 ? `Projects/Area-${i % 17}` : `Archive/${i % 23}`,
	}));
	const matcher = compileChipFilter(new Set(["work", "topic/11"]), new Set(["Projects"]));
	let visible = 0;

	describe(`chip filter · ${count} nodes`, () => {
		bench("combined tag and folder", () => {
			visible = 0;
			for (const item of facts) if (matcher.matches(item)) visible++;
			void visible;
		});
	});
}
