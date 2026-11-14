import { Notice, type App } from "obsidian";
import { t } from "../i18n";
import type { SearchPreset } from "../settings/schema";
import { sortSearchPresets } from "../settings/searchPresets";
import type { PanelState } from "../ui/ControlPanel";
import { SearchPresetModal } from "../ui/SearchPresetModal";
import { SearchPresetManagerModal } from "../ui/SearchPresetManagerModal";
import { ensureBuiltinPreset, type ViewPreset } from "./builtinPresets";
import type { BuiltinPresetId } from "./presetNames";
import { presetDisplayName } from "./presetNames";

export type PresetTaskAction =
	| { readonly id: string }
	| {
		readonly id: string;
		readonly presetId: BuiltinPresetId;
		readonly diagnostic: boolean;
	};

export interface PresetActionsDeps {
	getApp(): App;
	getSearchPresets(): SearchPreset[];
	saveSearchPresets(presets: SearchPreset[]): Promise<void>;
	setSearchPresets(presets: SearchPreset[]): void;
	applySearchQuery(query: string): void;
	getViewPresets(): ViewPreset[];
	getPanelState(): PanelState;
	saveViewPresets(presets: ViewPreset[]): Promise<void>;
	setViewPresets(presets: readonly ViewPreset[]): void;
	setSelectedViewPreset(index: number | null): void;
	setActivePresetIndex(index: number | null): void;
	clearPhysicsUndo(): void;
	requestAutoFit(): void;
	updatePanelState(mutate: (state: PanelState) => PanelState): Promise<void>;
	selectLinksTool(): void;
	clearHardQueryForTask(): void;
}

export class PresetActions {
	constructor(private readonly deps: PresetActionsDeps) {}

	private get app() { return this.deps.getApp(); }
	private get searchPresets() { return this.deps.getSearchPresets(); }
	private get viewPresets() { return this.deps.getViewPresets(); }

	/** Explicit naming instead of an automatic query-derived name. */
	savePreset(query: string): void {
		new SearchPresetModal(this.app, t("preset.modal.saveTitle"), { name: "", query }, (draft) => {
			const now = Date.now();
			void this.persistPresets([
				...this.searchPresets,
				{ id: crypto.randomUUID(), name: draft.name, query: draft.query, createdAt: now, updatedAt: now },
			]).then(() => new Notice(t("notice.filterPresetSaved")));
		}).open();
	}

	/** Save, then hand the freshly sorted list to the bar and the caller. */
	private async persistPresets(next: SearchPreset[]): Promise<SearchPreset[]> {
		await this.deps.saveSearchPresets(next);
		const sorted = sortSearchPresets(this.searchPresets);
		this.deps.setSearchPresets(sorted);
		return sorted;
	}

	/** Applying a preset moves it to the top of the recently-used order. */
	async markPresetUsed(id: string): Promise<void> {
		await this.persistPresets(
			this.searchPresets.map((preset) =>
				preset.id === id ? { ...preset, lastUsedAt: Date.now() } : preset
			)
		);
	}

	openPresetManager(): void {
		new SearchPresetManagerModal(this.app, sortSearchPresets(this.searchPresets), {
			onApply: (preset) => {
				this.deps.applySearchQuery(preset.query);
				void this.markPresetUsed(preset.id);
			},
			onUpdate: (next) =>
				this.persistPresets(
					this.searchPresets.map((preset) => (preset.id === next.id ? next : preset))
				),
			onDuplicate: (source) => {
				const now = Date.now();
				return this.persistPresets([
					...this.searchPresets,
					{
						id: crypto.randomUUID(),
						name: `${source.name}${t("preset.copySuffix")}`,
						query: source.query,
						createdAt: now,
						updatedAt: now,
					},
				]);
			},
			onDelete: (preset) =>
				this.persistPresets(this.searchPresets.filter((candidate) => candidate.id !== preset.id)),
		}).open();
	}

	async applyViewPreset(index: number): Promise<void> {
		const preset = this.viewPresets[index];
		if (!preset) return;
		this.deps.setActivePresetIndex(index);
		// The preset brings its own physics, so the reset's Undo no longer applies.
		this.deps.clearPhysicsUndo();
		this.deps.requestAutoFit();
		await this.deps.updatePanelState(() => preset.panel);
		new Notice(t("notice.presetApplied", { name: presetDisplayName(preset) }));
	}

	async saveViewPreset(name: string): Promise<void> {
		const existing = this.viewPresets;
		const snapshot = { name, panel: this.deps.getPanelState() };
		// Same name overwrites: saving twice must not pile up duplicates.
		const at = existing.findIndex((preset) => preset.name === name);
		const next = at >= 0
			? existing.map((preset, index) => (index === at ? snapshot : preset))
			: [...existing, snapshot];
		await this.deps.saveViewPresets(next);
		this.deps.setViewPresets(next);
		new Notice(
			at >= 0 ? t("notice.presetOverwritten", { name }) : t("notice.presetSaved", { name })
		);
	}

	async deleteViewPreset(index: number): Promise<void> {
		const existing = this.viewPresets;
		const preset = existing[index];
		if (!preset) return;
		const next = existing.filter((_, candidateIndex) => candidateIndex !== index);
		this.deps.setActivePresetIndex(null);
		await this.deps.saveViewPresets(next);
		this.deps.setViewPresets(next);
		this.deps.setSelectedViewPreset(null);
		new Notice(t("notice.presetDeleted", { name: presetDisplayName(preset) }));
	}

	/** Entry point shared by the menu and the per-action commands. */
	runTask(taskId: string, actions: readonly PresetTaskAction[]): void {
		const action = actions.find((task) => task.id === taskId);
		if (!action) return;
		if (!("presetId" in action)) {
			this.deps.selectLinksTool();
			return;
		}
		void this.runTaskPreset(action.presetId, action.diagnostic);
	}

	private async runTaskPreset(builtinId: BuiltinPresetId, diagnostic: boolean): Promise<void> {
		const ensured = ensureBuiltinPreset(this.viewPresets, builtinId);
		if (!ensured) return;
		if (ensured.presets !== this.viewPresets) {
			// Restore a bundled preset that the user deleted.
			await this.deps.saveViewPresets([...ensured.presets]);
			this.deps.setViewPresets(this.viewPresets);
		}
		if (diagnostic) this.deps.clearHardQueryForTask();
		await this.applyViewPreset(ensured.index);
	}
}
