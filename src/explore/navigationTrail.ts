/**
 * F-11: one history model behind the Focus and Explore breadcrumbs. Crumbs
 * hold vault paths, not node ids — ids do not survive a graph rebuild.
 *
 * Branching follows the spec: stepping back (or clicking an older crumb) only
 * moves the active index; the newer tail is kept until the NEXT new transition
 * overwrites it.
 */

export interface NavigationCrumb {
	path: string;
	label: string;
}

export const TRAIL_CAP = 50;

export class NavigationTrail {
	private crumbs: NavigationCrumb[] = [];
	private active = -1;

	constructor(readonly mode: "focus" | "explore") {}

	get items(): readonly NavigationCrumb[] {
		return this.crumbs;
	}

	get activeIndex(): number {
		return this.active;
	}

	get activeCrumb(): NavigationCrumb | null {
		return this.crumbs[this.active] ?? null;
	}

	/** A new transition. Truncates the branch after the active crumb, ignores
	 *  a repeat of the active path, and caps the history at TRAIL_CAP. */
	push(crumb: NavigationCrumb): void {
		if (this.activeCrumb?.path === crumb.path) return;
		this.crumbs = [...this.crumbs.slice(0, this.active + 1), crumb];
		if (this.crumbs.length > TRAIL_CAP) {
			this.crumbs = this.crumbs.slice(this.crumbs.length - TRAIL_CAP);
		}
		this.active = this.crumbs.length - 1;
	}

	/** Step to the previous crumb (Backspace). Keeps the tail. */
	back(): NavigationCrumb | null {
		if (this.active <= 0) return null;
		this.active--;
		return this.crumbs[this.active];
	}

	/** Jump to any crumb (a breadcrumb click). Keeps the tail. */
	jumpTo(index: number): NavigationCrumb | null {
		if (index < 0 || index >= this.crumbs.length) return null;
		this.active = index;
		return this.crumbs[index];
	}

	/** Drop a crumb the vault no longer has (deleted note). */
	removeAt(index: number): void {
		if (index < 0 || index >= this.crumbs.length) return;
		this.crumbs = this.crumbs.filter((_, i) => i !== index);
		if (this.active >= this.crumbs.length) this.active = this.crumbs.length - 1;
		else if (index < this.active) this.active--;
	}
}
