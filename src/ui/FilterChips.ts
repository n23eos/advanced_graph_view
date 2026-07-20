/**
 * Two standalone dropdowns next to the search bar: tags and folders.
 * Multi-select with checkboxes; the selection is compiled into a query
 * (tag:a OR tag:b is expressed as a dedicated filter, not query text).
 */

export interface FilterSelection {
	tags: Set<string>;
	folders: Set<string>;
}

export interface FilterChipsCallbacks {
	onChange(selection: FilterSelection): void;
}

export class FilterChips {
	private root: HTMLElement;
	private tagButton: HTMLElement;
	private folderButton: HTMLElement;
	private menu: HTMLElement;
	private openKind: "tags" | "folders" | null = null;
	private tags: string[] = [];
	private folders: string[] = [];
	private selection: FilterSelection = { tags: new Set(), folders: new Set() };

	constructor(host: HTMLElement, private readonly callbacks: FilterChipsCallbacks) {
		this.root = host.createDiv({ cls: "graph-insight-filters" });
		this.tagButton = this.makeButton("Tags");
		this.folderButton = this.makeButton("Folders");
		this.tagButton.addEventListener("click", () => this.toggleMenu("tags"));
		this.folderButton.addEventListener("click", () => this.toggleMenu("folders"));

		this.menu = this.root.createDiv({ cls: "graph-insight-filter-menu" });
		this.menu.hide();

		// Click outside closes the dropdown.
		document.addEventListener("click", this.handleOutsideClick, true);
	}

	private makeButton(label: string): HTMLElement {
		const button = this.root.createEl("button", { cls: "graph-insight-filter-btn", text: label });
		return button;
	}

	private handleOutsideClick = (event: MouseEvent): void => {
		if (this.openKind && !this.root.contains(event.target as Node)) this.closeMenu();
	};

	setVocabulary(tags: string[], folders: string[]): void {
		this.tags = tags;
		this.folders = folders;
		// Drop selections that no longer exist in the vault.
		for (const tag of [...this.selection.tags]) {
			if (!tags.includes(tag)) this.selection.tags.delete(tag);
		}
		for (const folder of [...this.selection.folders]) {
			if (!folders.includes(folder)) this.selection.folders.delete(folder);
		}
		this.refreshLabels();
		if (this.openKind) this.renderMenu(this.openKind);
	}

	private toggleMenu(kind: "tags" | "folders"): void {
		if (this.openKind === kind) {
			this.closeMenu();
			return;
		}
		this.openKind = kind;
		this.renderMenu(kind);
		this.menu.show();
	}

	private closeMenu(): void {
		this.openKind = null;
		this.menu.hide();
	}

	private renderMenu(kind: "tags" | "folders"): void {
		this.menu.empty();
		const values = kind === "tags" ? this.tags : this.folders;
		const selected = kind === "tags" ? this.selection.tags : this.selection.folders;

		const header = this.menu.createDiv({ cls: "graph-insight-filter-menu-header" });
		header.createSpan({ text: kind === "tags" ? "Vault tags" : "Vault folders" });
		const clear = header.createEl("button", { text: "Clear", cls: "graph-insight-searchbar-btn" });
		clear.addEventListener("click", () => {
			selected.clear();
			this.emit();
			this.renderMenu(kind);
		});

		if (values.length === 0) {
			this.menu.createDiv({ cls: "graph-insight-panel-hint", text: "Nothing found" });
			return;
		}

		const list = this.menu.createDiv({ cls: "graph-insight-filter-list" });
		for (const value of values) {
			const row = list.createEl("label", { cls: "graph-insight-filter-row" });
			const checkbox = row.createEl("input", { type: "checkbox" });
			checkbox.checked = selected.has(value);
			row.createSpan({ text: kind === "tags" ? `#${value}` : value });
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) selected.add(value);
				else selected.delete(value);
				this.emit();
			});
		}
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
		this.tagButton.setText(tagCount > 0 ? `Tags · ${tagCount}` : "Tags");
		this.folderButton.setText(folderCount > 0 ? `Folders · ${folderCount}` : "Folders");
		this.tagButton.toggleClass("is-active", tagCount > 0);
		this.folderButton.toggleClass("is-active", folderCount > 0);
	}

	destroy(): void {
		document.removeEventListener("click", this.handleOutsideClick, true);
		this.root.remove();
	}
}
