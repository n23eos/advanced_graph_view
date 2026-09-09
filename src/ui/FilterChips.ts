/**
 * Two standalone dropdowns next to the search bar: tags and folders.
 * Multi-select with checkboxes; the selection is compiled into a query
 * (tag:a OR tag:b is expressed as a dedicated filter, not query text).
 */

import { t } from "../i18n";

export interface FilterSelection {
	tags: Set<string>;
	folders: Set<string>;
}

export interface FilterChipsCallbacks {
	onChange(selection: FilterSelection): void;
}

export class FilterChips {
	private static nextId = 0;
	private root: HTMLElement;
	private tagButton: HTMLButtonElement;
	private folderButton: HTMLButtonElement;
	private menu: HTMLElement;
	private menuId: string;
	private openKind: "tags" | "folders" | null = null;
	private tags: string[] = [];
	private folders: string[] = [];
	private selection: FilterSelection = { tags: new Set(), folders: new Set() };
	private filterFrame: number | null = null;

	constructor(host: HTMLElement, private readonly callbacks: FilterChipsCallbacks) {
		this.root = host.createDiv({ cls: "graph-insight-filters" });
		this.menuId = `graph-insight-filter-menu-${FilterChips.nextId++}`;
		this.tagButton = this.makeButton(t("filters.tags"));
		this.folderButton = this.makeButton(t("filters.folders"));
		this.tagButton.addEventListener("click", () => this.toggleMenu("tags"));
		this.folderButton.addEventListener("click", () => this.toggleMenu("folders"));

		this.menu = this.root.createDiv({ cls: "graph-insight-filter-menu" });
		this.menu.id = this.menuId;
		this.menu.hide();
		this.menu.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			this.closeMenu(true);
		});

		// Click outside closes the dropdown.
		document.addEventListener("click", this.handleOutsideClick, true);
	}

	private makeButton(label: string): HTMLButtonElement {
		const button = this.root.createEl("button", { cls: "graph-insight-filter-btn", text: label });
		button.setAttribute("aria-haspopup", "true");
		button.setAttribute("aria-controls", this.menuId);
		button.setAttribute("aria-expanded", "false");
		return button;
	}

	private handleOutsideClick = (event: MouseEvent): void => {
		if (this.openKind && !this.root.contains(event.target as Node)) this.closeMenu();
	};

	/** Restore a selection (e.g. persisted from a previous session) without
	 *  firing onChange — the caller owns applying it. */
	setSelection(selection: FilterSelection): void {
		this.selection = {
			tags: new Set(selection.tags),
			folders: new Set(selection.folders),
		};
		this.refreshLabels();
		if (this.openKind) this.renderMenu(this.openKind);
	}

	setVocabulary(tags: string[], folders: string[]): void {
		this.tags = tags;
		this.folders = folders;
		// Drop selections that no longer exist in the vault.
		let selectionChanged = false;
		for (const tag of [...this.selection.tags]) {
			if (!tags.includes(tag)) {
				this.selection.tags.delete(tag);
				selectionChanged = true;
			}
		}
		for (const folder of [...this.selection.folders]) {
			if (!folders.includes(folder)) {
				this.selection.folders.delete(folder);
				selectionChanged = true;
			}
		}
		this.refreshLabels();
		if (this.openKind) this.renderMenu(this.openKind);
		if (selectionChanged) this.emit();
	}

	private toggleMenu(kind: "tags" | "folders"): void {
		if (this.openKind === kind) {
			this.closeMenu();
			return;
		}
		this.openKind = kind;
		this.renderMenu(kind);
		this.menu.show();
		this.refreshExpandedState();
		this.menu.querySelector<HTMLInputElement>("input[type=search]")?.focus();
	}

	private closeMenu(restoreFocus = false): void {
		const trigger = this.openKind === "tags" ? this.tagButton : this.folderButton;
		if (this.filterFrame !== null) window.cancelAnimationFrame(this.filterFrame);
		this.filterFrame = null;
		this.openKind = null;
		this.menu.hide();
		this.refreshExpandedState();
		if (restoreFocus) trigger.focus();
	}

	private renderMenu(kind: "tags" | "folders"): void {
		if (this.filterFrame !== null) window.cancelAnimationFrame(this.filterFrame);
		this.filterFrame = null;
		this.menu.empty();
		const selected = kind === "tags" ? this.selection.tags : this.selection.folders;

		const header = this.menu.createDiv({ cls: "graph-insight-filter-menu-header" });
		header.createSpan({ text: kind === "tags" ? t("filters.vaultTags") : t("filters.vaultFolders") });
		const clear = header.createEl("button", { text: t("filters.clear"), cls: "graph-insight-searchbar-btn" });
		clear.addEventListener("click", () => {
			selected.clear();
			this.emit();
			this.renderMenu(kind);
		});

		const search = this.menu.createEl("input", {
			type: "search",
			cls: "graph-insight-filter-search",
			placeholder: t("filters.search"),
		});
		search.setAttribute("aria-label", kind === "tags" ? t("filters.vaultTags") : t("filters.vaultFolders"));
		search.addEventListener("input", () => {
			if (this.filterFrame !== null) window.cancelAnimationFrame(this.filterFrame);
			this.filterFrame = window.requestAnimationFrame(() => {
				this.filterFrame = null;
				this.renderList(kind, search.value);
			});
		});
		this.renderList(kind, "");
	}

	private renderList(kind: "tags" | "folders", query: string): void {
		const values = kind === "tags" ? this.tags : this.folders;
		const selected = kind === "tags" ? this.selection.tags : this.selection.folders;
		const needle = query.trim().toLocaleLowerCase();
		let list = this.menu.querySelector<HTMLElement>(".graph-insight-filter-list");
		if (!list) {
			list = this.menu.createDiv({ cls: "graph-insight-filter-list" });
			// Keep rows stable while typing and navigating with the keyboard.
			const ordered = [...values].sort((a, b) => Number(selected.has(b)) - Number(selected.has(a)));
			for (const value of ordered) {
				const row = list.createEl("label", { cls: "graph-insight-filter-row" });
				row.dataset.filterValue = value.toLocaleLowerCase();
				const checkbox = row.createEl("input", { type: "checkbox" });
				checkbox.checked = selected.has(value);
				row.createSpan({ text: kind === "tags" ? `#${value}` : value });
				checkbox.addEventListener("change", () => {
					if (checkbox.checked) selected.add(value);
					else selected.delete(value);
					this.emit();
					const search = this.menu.querySelector<HTMLInputElement>("input[type=search]");
					this.renderList(kind, search?.value ?? "");
				});
			}
		}

		let visible = 0;
		for (const row of list.querySelectorAll<HTMLElement>(".graph-insight-filter-row")) {
			const checkbox = row.querySelector<HTMLInputElement>("input[type=checkbox]");
			const show = !needle || checkbox?.checked === true || row.dataset.filterValue?.includes(needle) === true;
			row.hidden = !show;
			if (show) visible++;
		}
		let empty = this.menu.querySelector<HTMLElement>(".graph-insight-filter-empty");
		if (visible === 0 && !empty) {
			empty = this.menu.createDiv({ cls: "graph-insight-panel-hint graph-insight-filter-empty", text: t("filters.empty") });
		}
		if (visible > 0) empty?.remove();
	}

	private emit(): void {
		this.refreshLabels();
		this.callbacks.onChange({
			tags: new Set(this.selection.tags),
			folders: new Set(this.selection.folders),
		});
	}

	private refreshLabels(): void {
		const tagCount = this.selection.tags.size;
		const folderCount = this.selection.folders.size;
		this.tagButton.setText(tagCount > 0 ? t("filters.tagsCount", { count: tagCount }) : t("filters.tags"));
		this.folderButton.setText(
			folderCount > 0 ? t("filters.foldersCount", { count: folderCount }) : t("filters.folders")
		);
		this.tagButton.toggleClass("is-active", tagCount > 0);
		this.folderButton.toggleClass("is-active", folderCount > 0);
		this.tagButton.setAttribute("aria-pressed", String(tagCount > 0));
		this.folderButton.setAttribute("aria-pressed", String(folderCount > 0));
	}

	private refreshExpandedState(): void {
		this.tagButton.setAttribute("aria-expanded", String(this.openKind === "tags"));
		this.folderButton.setAttribute("aria-expanded", String(this.openKind === "folders"));
	}

	destroy(): void {
		if (this.filterFrame !== null) window.cancelAnimationFrame(this.filterFrame);
		document.removeEventListener("click", this.handleOutsideClick, true);
		this.root.remove();
	}
}
