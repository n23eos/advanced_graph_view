/**
 * F-11: breadcrumb strip for the focus/explore status bar. Pure rendering —
 * the NavigationTrail owns the history, the host owns what a click does.
 */
import { t } from "../i18n";
import type { NavigationCrumb } from "../explore/navigationTrail";

export interface BreadcrumbCallbacks {
	onCrumb(index: number): void;
	onRemove(index: number): void;
}

/** Which crumbs a narrow bar shows: the first, the second-to-last and the
 *  active one; everything between collapses into an ellipsis. */
export function visibleIndexes(count: number, activeIndex: number, narrow: boolean): number[] {
	if (count <= 0) return [];
	if (!narrow || count <= 4) return Array.from({ length: count }, (_, i) => i);
	const picked = new Set([0, count - 2, activeIndex]);
	return [...picked].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
}

export function renderBreadcrumb(
	host: HTMLElement,
	trail: { items: readonly NavigationCrumb[]; activeIndex: number },
	isMissing: (path: string) => boolean,
	narrow: boolean,
	callbacks: BreadcrumbCallbacks
): void {
	host.empty();
	if (trail.items.length === 0) return;
	let previous = -1;
	for (const index of visibleIndexes(trail.items.length, trail.activeIndex, narrow)) {
		if (previous >= 0) {
			host.createSpan({
				cls: "graph-insight-breadcrumb-sep",
				text: index > previous + 1 ? "…" : "›",
			});
		}
		const item = trail.items[index];
		const missing = isMissing(item.path);
		const button = host.createEl("button", {
			text: item.label,
			cls: "graph-insight-breadcrumb-crumb",
		});
		button.toggleClass("is-active", index === trail.activeIndex);
		button.disabled = missing;
		if (!missing) button.addEventListener("click", () => callbacks.onCrumb(index));
		if (missing) {
			const remove = host.createEl("button", {
				text: "✕",
				cls: "graph-insight-breadcrumb-remove",
			});
			remove.setAttribute("aria-label", t("trail.remove"));
			remove.addEventListener("click", () => callbacks.onRemove(index));
		}
		previous = index;
	}
}
