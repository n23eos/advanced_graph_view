import type { PanelState } from "../ui/ControlPanel";

export interface PanelDiff {
	applyEncoding: boolean;
	applyOverlays: boolean;
	redrawBubbles: boolean;
	syncTimelineAndTrail: boolean;
}

export function panelDiff(prev: PanelState | undefined, next: PanelState): PanelDiff {
	if (!prev) {
		return {
			applyEncoding: true,
			applyOverlays: true,
			redrawBubbles: true,
			syncTimelineAndTrail: true,
		};
	}

	const applyEncoding = prev.channels !== next.channels ||
		prev.colorPreset !== next.colorPreset ||
		prev.nodeStyle !== next.nodeStyle ||
		prev.nodeScale !== next.nodeScale;

	return {
		applyEncoding,
		applyOverlays: prev.overlays !== next.overlays,
		redrawBubbles: applyEncoding || prev.showBubbles !== next.showBubbles,
		syncTimelineAndTrail: prev.showTimeline !== next.showTimeline || prev.showTrail !== next.showTrail,
	};
}
