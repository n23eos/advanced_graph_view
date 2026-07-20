/**
 * Top search bar: live soft-highlight while typing, Enter = hard filter,
 * Esc = clear. The preset dropdown mixes saved presets with auto-generated
 * tag: / path: filters from the vault; typing tag:/path: opens completion
 * suggestions (with "-" negation supported, like the core graph).
 */

export interface SearchPreset {
	name: string;
	query: string;
}

export interface SearchCallbacks {
	onQueryChange(query: string): void;
	onCommit(query: string): void;
	onClear(): void;
	onSavePreset(query: string): void;
}

const SUGGESTION_LIMIT = 12;

interface Suggestion {
	label: string;
	/** Full replacement for the current token. */
	token: string;
}

export class SearchBar {
	private root: HTMLElement;
	private input: HTMLInputElement;
	private presetSelect: HTMLSelectElement;
	private suggestBox: HTMLElement;
	private presets: SearchPreset[] = [];
	private tags: string[] = [];
	private folders: string[] = [];
	private activeSuggestion = -1;
	private suggestions: Suggestion[] = [];
	/** Mount point for the standalone tag/folder dropdowns. */
	readonly filtersHost: HTMLElement;

	constructor(host: HTMLElement, private readonly callbacks: SearchCallbacks) {
		this.root = host.createDiv({ cls: "graph-insight-searchbar" });
		this.filtersHost = this.root.createDiv({ cls: "graph-insight-searchbar-filters" });

		const inputWrap = this.root.createDiv({ cls: "graph-insight-searchbar-input" });
		this.input = inputWrap.createEl("input", {
			type: "text",
			placeholder: "Search: word, path: tag: content: opened:>10 -exclude…",
		});
		this.suggestBox = inputWrap.createDiv({ cls: "graph-insight-suggest" });
		this.suggestBox.hide();

		this.input.addEventListener("input", () => {
			this.callbacks.onQueryChange(this.input.value);
			this.updateSuggestions();
		});
		this.input.addEventListener("blur", () => {
			// Delay so a click on a suggestion lands before the box hides.
			window.setTimeout(() => this.suggestBox.hide(), 150);
		});
		this.input.addEventListener("keydown", (event) => {
			if (this.suggestions.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				this.activeSuggestion =
					(this.activeSuggestion + delta + this.suggestions.length) % this.suggestions.length;
				this.renderSuggestions();
				return;
			}
			if (event.key === "Tab" && this.suggestions.length > 0) {
				event.preventDefault();
				this.applySuggestion(this.suggestions[Math.max(0, this.activeSuggestion)]);
				return;
			}
			if (event.key === "Enter") {
				if (this.activeSuggestion >= 0 && this.suggestions[this.activeSuggestion]) {
					event.preventDefault();
					this.applySuggestion(this.suggestions[this.activeSuggestion]);
					return;
				}
				this.suggestBox.hide();
				this.callbacks.onCommit(this.input.value);
			}
			if (event.key === "Escape") {
				this.suggestBox.hide();
				this.clear();
			}
		});

		this.presetSelect = this.root.createEl("select", { cls: "dropdown" });
		this.presetSelect.addEventListener("change", () => {
			const value = this.presetSelect.value;
			if (value) {
				this.input.value = value;
				this.callbacks.onCommit(value);
			}
			this.presetSelect.value = "";
		});

		const saveButton = this.root.createEl("button", { text: "★", cls: "graph-insight-searchbar-btn" });
		saveButton.setAttribute("aria-label", "Save filter as preset");
		saveButton.addEventListener("click", () => {
			if (this.input.value.trim()) this.callbacks.onSavePreset(this.input.value.trim());
		});

		const clearButton = this.root.createEl("button", { text: "✕", cls: "graph-insight-searchbar-btn" });
		clearButton.setAttribute("aria-label", "Clear filter");
		clearButton.addEventListener("click", () => this.clear());
	}

	clear(): void {
		this.input.value = "";
		this.suggestBox.hide();
		this.callbacks.onClear();
	}

	setPresets(presets: SearchPreset[]): void {
		this.presets = presets;
		this.rebuildPresetSelect();
	}

	/** Vault tags and folders feed suggestions and auto-presets. */
	setVocabulary(tags: string[], folders: string[]): void {
		this.tags = tags;
		this.folders = folders;
		this.rebuildPresetSelect();
	}

	private rebuildPresetSelect(): void {
		this.presetSelect.empty();
		const placeholder = this.presetSelect.createEl("option", { text: "Filters…", value: "" });
		placeholder.disabled = true;
		placeholder.selected = true;

		if (this.presets.length > 0) {
			const group = this.presetSelect.createEl("optgroup");
			group.label = "Presets";
			for (const preset of this.presets) {
				group.createEl("option", { text: preset.name, value: preset.query });
			}
		}
		if (this.tags.length > 0) {
			const group = this.presetSelect.createEl("optgroup");
			group.label = "Tags";
			for (const tag of this.tags) {
				group.createEl("option", { text: `#${tag}`, value: `tag:${tag}` });
			}
		}
		if (this.folders.length > 0) {
			const group = this.presetSelect.createEl("optgroup");
			group.label = "Folders";
			for (const folder of this.folders) {
				group.createEl("option", { text: folder, value: `path:"${folder}"` });
			}
		}
	}

	// ── Suggestions ───────────────────────────────────────────────────

	private currentToken(): { token: string; start: number } {
		const value = this.input.value;
		const cursor = this.input.selectionStart ?? value.length;
		const before = value.slice(0, cursor);
		const start = Math.max(before.lastIndexOf(" ") + 1, 0);
		return { token: before.slice(start), start };
	}

	private updateSuggestions(): void {
		const { token } = this.currentToken();
		this.suggestions = this.buildSuggestions(token);
		this.activeSuggestion = this.suggestions.length > 0 ? 0 : -1;
		this.renderSuggestions();
	}

	private buildSuggestions(rawToken: string): Suggestion[] {
		if (!rawToken) return [];
		const negation = rawToken.startsWith("-") ? "-" : "";
		const token = negation ? rawToken.slice(1) : rawToken;

		const fromList = (
			values: string[],
			needle: string,
			prefix: "tag" | "path",
			icon: string
		): Suggestion[] =>
			values
				.filter((value) => value.toLowerCase().includes(needle.toLowerCase()))
				.slice(0, SUGGESTION_LIMIT)
				.map((value) => ({
					label: `${icon} ${value}`,
					token: `${negation}${prefix}:${value.includes(" ") ? `"${value}"` : value}`,
				}));

		if (token.startsWith("tag:") || token.startsWith("#")) {
			const needle = token.replace(/^tag:|^#/, "").replace(/^#/, "");
			return fromList(this.tags, needle, "tag", "#");
		}
		if (token.startsWith("path:")) {
			return fromList(this.folders, token.slice(5).replace(/^"/, ""), "path", "📁");
		}
		// Plain text: offer matching tags and folders alongside.
		if (token.length >= 2) {
			return [
				...fromList(this.tags, token, "tag", "#"),
				...fromList(this.folders, token, "path", "📁"),
			].slice(0, SUGGESTION_LIMIT);
		}
		return [];
	}

	private renderSuggestions(): void {
		this.suggestBox.empty();
		if (this.suggestions.length === 0) {
			this.suggestBox.hide();
			return;
		}
		this.suggestBox.show();
		this.suggestions.forEach((suggestion, index) => {
			const row = this.suggestBox.createDiv({ cls: "graph-insight-suggest-row" });
			if (index === this.activeSuggestion) row.addClass("is-active");
			row.setText(suggestion.label);
			row.addEventListener("mousedown", (event) => {
				event.preventDefault();
				this.applySuggestion(suggestion);
			});
		});
	}

	private applySuggestion(suggestion: Suggestion): void {
		const { token, start } = this.currentToken();
		const value = this.input.value;
		const cursor = this.input.selectionStart ?? value.length;
		this.input.value = `${value.slice(0, start)}${suggestion.token}${value.slice(cursor)} `.replace(/\s+$/, " ");
		this.input.focus();
		const newCursor = start + suggestion.token.length + 1;
		this.input.setSelectionRange(newCursor, newCursor);
		this.suggestions = [];
		this.activeSuggestion = -1;
		this.suggestBox.hide();
		this.callbacks.onQueryChange(this.input.value);
		void token;
	}

	destroy(): void {
		this.root.remove();
	}
}
