/**
 * Shape of everything the plugin persists, and the values it starts from.
 * Kept free of the Obsidian runtime so settings logic can be unit-tested.
 */
import type { PanelMode, PanelState } from "../ui/ControlPanel";
import { DEFAULT_3D_PANEL, type ViewPreset } from "../view/builtinPresets";

/** Where the user is in the first-run tour. Replaces the old boolean
 *  `onboardingShown`; `disabled` is "don't show me this again". */
export type OnboardingState = "never-seen" | "dismissed" | "completed" | "disabled";

export const ONBOARDING_STATES: readonly OnboardingState[] = [
	"never-seen", "dismissed", "completed", "disabled",
];

/** A saved search filter. Older versions stored only { name, query };
 *  normalizeSettings backfills id and timestamps on load. */
export interface SearchPreset {
	id: string;
	name: string;
	query: string;
	createdAt: number;
	updatedAt: number;
	/** Bumped on apply; drives the "recently used first" ordering (F-09). */
	lastUsedAt?: number;
}

export interface GraphInsightSettings {
	panel: PanelState;
	/** How much of the control panel is on show. Not part of PanelState: it is
	 *  which controls you see, not what the graph looks like, so a view preset
	 *  never drags the user back into the panel they did not choose. */
	panelMode: PanelMode;
	viewPresets: ViewPreset[];
	presets: SearchPreset[];
	onboardingState: OnboardingState;
	/** Which expert-panel sections start collapsed. UI preference only —
	 *  never part of a view preset. */
	collapsedSections: { physics: boolean };
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
	onboardingState: "never-seen",
	collapsedSections: { physics: true },
};
