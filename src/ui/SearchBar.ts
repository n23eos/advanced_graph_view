/**
 * Top search bar: live soft-highlight while typing, Enter = hard filter,
 * Esc = clear. The preset dropdown mixes saved presets with auto-generated
 * tag: / path: filters from the vault; typing tag:/path: opens completion
 * suggestions (with "-" negation supported, like the core graph).
 */

import { t } from "../i18n";

import type { SearchPreset } from "../settings/schema";
import type { QueryDiagnostic } from "../query/QueryParser";
import { queryErrorText } from "./queryErrors";

export type { SearchPreset };

export interface SearchCallbacks {
	onQueryChange(query: string): void;
	onCommit(query: string): void;
	onClear(): void;
	onSavePreset(query: string): void;
	/** A saved preset was applied — the host bumps its recently-used stamp. */
	onPresetApplied(id: string): void;
	/** Open the saved-filter manager (F-09). */
	onManagePresets(): void;
}

/** Dropdown values: saved presets travel by id, tag/folder rows by query. */
const PRESET_VALUE_PREFIX = "preset:";

/** idle: nothing active; highlight: soft matches glow while typing;
 *  filter: Enter turned the query into a hard filter. */
export type SearchMode = "idle" | "highlight" | "filter";

/** Everything the host computed about the search, rendered by the bar. */
export interface SearchUiState {
	mode: SearchMode;
	/** The committed hard query, "" when none — shown as a removable chip. */
	query: string;
	matchedCount: number;
	totalCount: number;
	isIndexingContent: boolean;
	parseError?: QueryDiagnostic;
}

const SUGGESTION_LIMIT = 12;
/** Blur-to-hide delay: long enough for a click on a suggestion to land first. */
const SUGGEST_HIDE_DELAY_MS = 150;
/** aria-live regions must not announce every keystroke (§8: max once per 300 ms). */
const STATUS_THROTTLE_MS = 300;

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
	/** Pending blur-delay timer, cleared on destroy so it can never outlive the bar. */
	private blurTimer: number | null = null;
	/** Mount point for the standalone tag/folder dropdowns. */
	readonly filtersHost: HTMLElement;
	private statusEl: HTMLElement;
	private chipEl: HTMLElement;
	private hintEl: HTMLElement;
	/** Once the user commits a filter the Enter hint has done its job. */
	private hasCommitted = false;
	/** Trailing throttle so the aria-live status stays quiet while typing. */
	private statusTimer: number | null = null;

	constructor(host: HTMLElement, private readonly callbacks: SearchCallbacks) {
		this.root = host.createDiv({ cls: "graph-insight-searchbar" });
		this.filtersHost = this.root.createDiv({ cls: "graph-insight-searchbar-filters" });

		const inputWrap = this.root.createDiv({ cls: "graph-insight-searchbar-input" });
		this.input = inputWrap.createEl("input", {
			type: "text",
			placeholder: t("search.placeholder"),
		});
		this.suggestBox = inputWrap.createDiv({ cls: "graph-insight-suggest" });
		this.suggestBox.hide();

		this.input.addEventListener("input", () => {
			this.callbacks.onQueryChange(this.input.value);
			this.updateSuggestions();
		});
		this.input.addEventListener("blur", () => {
			// Delay so a click on a suggestion lands before the box hides.
			if (this.blurTimer !== null) window.clearTimeout(this.blurTimer);
			this.blurTimer = window.setTimeout(() => {
				this.blurTimer = null;
				this.suggestBox.hide();
			}, SUGGEST_HIDE_DELAY_MS);
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
				this.hasCommitted = true;
				this.callbacks.onCommit(this.input.value);
			}
			if (event.key === "Escape") {
				// First Escape only dismisses open suggestions; the next one clears.
				if (this.suggestions.length > 0) {
					this.suggestions = [];
					this.activeSuggestion = -1;
					this.suggestBox.hide();
					return;
				}
				this.clear();
			}
		});

		this.presetSelect = this.root.createEl("select", { cls: "dropdown" });
		this.presetSelect.addEventListener("change", () => {
			const value = this.presetSelect.value;
			if (value.startsWith(PRESET_VALUE_PREFIX)) {
				const id = value.slice(PRESET_VALUE_PREFIX.length);
				const preset = this.presets.find((p) => p.id === id);
				if (preset) {
					this.applyQuery(preset.query);
					this.callbacks.onPresetApplied(preset.id);
				}
			} else if (value) {
				this.applyQuery(value);
			}
			this.presetSelect.value = "";
		});

		const saveButton = this.root.createEl("button", {
			text: "★",
			cls: "graph-insight-searchbar-btn graph-insight-searchbar-secondary",
		});
		saveButton.setAttribute("aria-label", t("search.savePreset"));
		saveButton.addEventListener("click", () => {
			if (this.input.value.trim()) this.callbacks.onSavePreset(this.input.value.trim());
		});

		const manageButton = this.root.createEl("button", {
			text: "≡",
			cls: "graph-insight-searchbar-btn graph-insight-searchbar-secondary",
		});
		manageButton.setAttribute("aria-label", t("preset.manage"));
		manageButton.addEventListener("click", () => this.callbacks.onManagePresets());

		const clearButton = this.root.createEl("button", { text: "✕", cls: "graph-insight-searchbar-btn" });
		clearButton.setAttribute("aria-label", t("search.clear"));
		clearButton.addEventListener("click", () => this.clear());

		const statusRow = this.root.createDiv({ cls: "graph-insight-search-statusrow" });
		this.chipEl = statusRow.createDiv({ cls: "graph-insight-search-chip" });
		this.chipEl.hide();
		this.statusEl = statusRow.createDiv({
			cls: "graph-insight-search-status",
			attr: { "aria-live": "polite" },
		});
		this.hintEl = statusRow.createDiv({ cls: "graph-insight-search-hint", text: t("search.hint.commit") });
		this.hintEl.hide();
	}

	/** Render what the host computed: mode, counters, chip, errors, hints. */
	setUiState(state: SearchUiState): void {
		this.chipEl.empty();
		if (state.query) {
			this.chipEl.createSpan({ text: state.query });
			const remove = this.chipEl.createEl("button", { text: "✕" });
			remove.setAttribute("aria-label", t("search.clear"));
			remove.addEventListener("click", () => this.clear());
			this.chipEl.show();
		} else {
			this.chipEl.hide();
		}

		const showHint = state.mode === "highlight" && !this.hasCommitted;
		this.hintEl.toggleClass("is-hidden", !showHint);
		if (showHint) this.hintEl.show();
		else this.hintEl.hide();

		this.input.toggleClass("has-error", state.parseError !== undefined);
		if (state.parseError) {
			// Errors preempt the throttle: the user just hit Enter and waits.
			this.setStatusText(queryErrorText(state.parseError), true);
			return;
		}
		this.setStatusText(this.statusFor(state), false);
	}

	private statusFor(state: SearchUiState): string {
		if (state.isIndexingContent) return t("search.status.indexing");
		if (state.mode === "filter") {
			return t("search.status.shown", {
				count: String(state.matchedCount),
				total: String(state.totalCount),
			});
		}
		if (state.mode === "highlight") {
			return t("search.status.highlighted", { count: String(state.matchedCount) });
		}
		return "";
	}

	private setStatusText(text: string, immediate: boolean): void {
		if (this.statusTimer !== null) {
			window.clearTimeout(this.statusTimer);
			this.statusTimer = null;
		}
		if (immediate) {
			this.statusEl.setText(text);
			return;
		}
		this.statusTimer = window.setTimeout(() => {
			this.statusTimer = null;
			this.statusEl.setText(text);
		}, STATUS_THROTTLE_MS);
	}

	clear(): void {
		this.input.value = "";
		this.suggestBox.hide();
		this.callbacks.onClear();
	}

	/** Put a query into the input and commit it as the hard filter. */
	applyQuery(query: string): void {
		this.input.value = query;
		this.suggestBox.hide();
		this.hasCommitted = true;
		this.callbacks.onCommit(query);
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
		const placeholder = this.presetSelect.createEl("option", { text: t("search.filters"), value: "" });
		placeholder.disabled = true;
		placeholder.selected = true;

		if (this.presets.length > 0) {
			const group = this.presetSelect.createEl("optgroup");
			group.label = t("search.group.presets");
			for (const preset of this.presets) {
				group.createEl("option", { text: preset.name, value: `${PRESET_VALUE_PREFIX}${preset.id}` });
			}
		}
		if (this.tags.length > 0) {
			const group = this.presetSelect.createEl("optgroup");
			group.label = t("search.group.tags");
			for (const tag of this.tags) {
				group.createEl("option", { text: `#${tag}`, value: `tag:${tag}` });
			}
		}
		if (this.folders.length > 0) {
			const group = this.presetSelect.createEl("optgroup");
			group.label = t("search.group.folders");
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
		if (this.blurTimer !== null) {
			window.clearTimeout(this.blurTimer);
			this.blurTimer = null;
		}
		if (this.statusTimer !== null) {
			window.clearTimeout(this.statusTimer);
			this.statusTimer = null;
		}
		this.root.remove();
	}
}
