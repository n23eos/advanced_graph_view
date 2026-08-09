/**
 * Shape of everything the plugin persists, and the values it starts from.
 * Kept free of the Obsidian runtime so settings logic can be unit-tested.
 */
import type { PanelMode, PanelState } from "../ui/ControlPanel";
import type { SearchPreset } from "../ui/SearchBar";
import { DEFAULT_3D_PANEL, type ViewPreset } from "../view/builtinPresets";

export interface GraphInsightSettings {
	panel: PanelState;
	/** How much of the control panel is on show. Not part of PanelState: it is
	 *  which controls you see, not what the graph looks like, so a view preset
	 *  never drags the user back into the panel they did not choose. */
	panelMode: PanelMode;
	viewPresets: ViewPreset[];
	presets: SearchPreset[];
	onboardingShown: boolean;
	/** Version of the built-in view presets last seeded. Lower than
	 *  VIEW_PRESET_VERSION triggers a one-time re-seed + retire migration. */
	viewPresetsVersion: number;
	/** Open counts only when the file stays active at least this long. */
	openDwellSeconds: number;
	/** Note-body preview shown in the hover tooltip. */
	hoverPreview: HoverPreviewSettings;
	/** Last tag/folder filter, restored on the next session. */
	chipFilter: { tags: string[]; folders: string[] };
	/** Camera follows the note you open elsewhere in the vault. Not part of
	 *  PanelState: it is how the view behaves, not what a view preset looks like. */
	followActiveNote: boolean;
	/** A plain click opens the note in a pane beside the graph, so the graph
	 *  stays visible. The same pane is reused for every note. */
	openInSidePane: boolean;
	/** Local graph pane: how it was left last time. */
	localGraph: LocalGraphSettings;
}

export interface LocalGraphSettings {
	/** Hops around the active note, 1–4. */
	depth: number;
	/** Perspective camera on. Off draws the neighborhood flat. */
	view3d: boolean;
}

export interface HoverPreviewSettings {
	/** When off, the tooltip stays name + metadata only. */
	enabled: boolean;
	/** How many leading words of the note body to show. */
	words: number;
	/** Hold the cursor on a node this long before the preview loads. */
	delayMs: number;
}

export const DEFAULT_SETTINGS: GraphInsightSettings = {
	panel: DEFAULT_3D_PANEL,
	panelMode: "simple",
	openDwellSeconds: 5,
	hoverPreview: { enabled: true, words: 300, delayMs: 350 },
	chipFilter: { tags: [], folders: [] },
	followActiveNote: false,
	openInSidePane: false,
	localGraph: { depth: 2, view3d: true },
	presets: [],
	viewPresets: [],
	viewPresetsVersion: 0,
	onboardingShown: false,
};
