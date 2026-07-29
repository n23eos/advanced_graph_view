/**
 * English source of truth. Every other locale is typed against this object, so
 * adding a key here breaks the build until all 12 locales carry it.
 *
 * Keys are `area.thing`. Placeholders use `{name}` and are substituted at call
 * time — never build a sentence by concatenating translated fragments.
 */
export const en = {
	// ── Panel chrome ──────────────────────────────────────────────────
	"panel.title": "Advanced Graph View",
	"panel.section.presets": "View presets",
	"panel.section.appearance": "Appearance",
	"panel.section.labels": "Labels",
	"panel.section.links": "Links",
	"panel.section.threeD": "3D",
	"panel.section.layers": "Layers",
	"panel.section.clusters": "Clusters",
	"panel.section.physics": "Physics",

	// ── View presets ──────────────────────────────────────────────────
	"presets.save": "Save current",
	"presets.delete": "Delete",
	"presets.choose": "Choose a preset…",
	"presets.empty": "No presets yet",

	// Bundled preset names, addressed by their stable builtinId.
	"preset.default-3d": "Default 3D",
	"preset.default-2d": "Default 2D",
	"preset.hubs-clusters": "Hubs and Clusters",
	"preset.recent": "Recent",
	"preset.wide-range": "Wide Range",
	"preset.density": "Density",
	"preset.small-nodes-2d": "Small Nodes 2D",
	"preset.minimalism": "Minimalism",

	// ── Appearance ────────────────────────────────────────────────────
	"appearance.size": "Size",
	"appearance.color": "Color",
	"appearance.glow": "Glow",
	"appearance.colorScheme": "Color scheme",
	"appearance.colorHint": "Pick a metric for the Color channel to colorize nodes.",
	"appearance.nodeSize": "Node size",

	// ── Labels ────────────────────────────────────────────────────────
	"labels.show": "Show labels",
	"labels.size": "Label size",
	"labels.zoom": "Show labels from zoom",
	"labels.max": "Max labels",
	"labels.scaleWithZoom": "Labels shrink with zoom",

	// ── Links ─────────────────────────────────────────────────────────
	"edges.show": "Show links",
	"edges.width": "Thickness",
	"edges.opacity": "Opacity",

	// ── 3D ────────────────────────────────────────────────────────────
	"view3d.enabled": "3D mode",
	"view3d.depth": "Depth",
	"view3d.depth.physics": "Physics (sphere)",
	"view3d.depth.cluster": "Cluster (layers)",
	"view3d.depth.age": "Age",
	"view3d.focal": "Perspective",
	"view3d.hint": "Drag empty space to rotate. Alt+drag to pan.",

	// ── Layers ────────────────────────────────────────────────────────
	"layers.hint": "An active layer highlights matching notes and dims the rest.",
	"layers.orphans": "Orphans (nothing links here)",
	"layers.deadEnds": "Dead ends (no outgoing links)",
	"layers.broken": "Broken links",
	"layers.hidden": "Hidden nodes",
	"layers.showAll": "Show all",
	"layers.reset": "Reset highlights and hidden",
	"layers.timeline": "Timeline",
	"layers.trail": "Session trail",
	"layers.trailReplay": "Replay the session trail",

	// ── Clusters ──────────────────────────────────────────────────────
	"clusters.bubbles": "Cluster bubbles",
	"clusters.hint": "Color nodes by Cluster to see groups",

	// ── Physics ───────────────────────────────────────────────────────
	"physics.layoutRule": "Layout rules",
	"physics.rule.links": "Links",
	"physics.rule.tags": "Tags",
	"physics.rule.folders": "Folders",
	"physics.repel": "Node spread (repulsion)",
	"physics.linkDistance": "Link length",
	"physics.centering": "Pull to center",
	"physics.linkStrength": "Link strength",
	"physics.velocityDecay": "Smoothness",
	"physics.elasticity": "Link elasticity",
	"physics.freeLayout": "Free layout",
	"physics.disabled": "Turn physics off",
	"physics.reheat": "Re-form the cloud",

	// ── Metrics ───────────────────────────────────────────────────────
	"metric.opens-total": "Opens (all time)",
	"metric.opens-90": "Opens (90 days)",
	"metric.opens-30": "Opens (30 days)",
	"metric.opens-7": "Opens (7 days)",
	"metric.recency-edit": "Edit recency",
	"metric.age-created": "Note age",
	"metric.links-in": "Inbound links",
	"metric.links-out": "Outbound links",
	"metric.links-total": "All links",
	"metric.file-size": "File size",
	"metric.pagerank": "PageRank",
	"metric.folder": "Folder",
	"metric.tag": "Tag",
	"metric.cluster": "Cluster",

	// ── Color scales ──────────────────────────────────────────────────
	"scale.recency": "Amber → steel",
	"scale.heat": "Fire",
	"scale.mono": "Mono",
	"scale.galaxy": "Galaxy ✨",
	"scale.nebula": "Nebula ✨",
	"scale.neon": "Neon ✨",
	"scale.solar": "Solar",
	"scale.pastel": "Pastel",

	// ── Search bar ────────────────────────────────────────────────────
	"search.placeholder": "Search: word, path: tag: content: opened:>10 -exclude…",
	"search.savePreset": "Save filter as preset",
	"search.clear": "Clear filter",
	"search.filters": "Filters…",
	"search.group.presets": "Presets",
	"search.group.tags": "Tags",
	"search.group.folders": "Folders",

	// ── Filter chips ──────────────────────────────────────────────────
	"filters.tags": "Tags",
	"filters.folders": "Folders",
	"filters.tagsCount": "Tags · {count}",
	"filters.foldersCount": "Folders · {count}",
	"filters.vaultTags": "Vault tags",
	"filters.vaultFolders": "Vault folders",
	"filters.clear": "Clear",
	"filters.empty": "Nothing found",

	// ── Timeline ──────────────────────────────────────────────────────
	"timeline.created": "Created",
	"timeline.modified": "Modified",

	// ── Cursor tools ──────────────────────────────────────────────────
	"tool.open": "Open",
	"tool.open.hint": "Click opens the note",
	"tool.links": "Links",
	"tool.links.hint": "Click reveals the neighborhood N steps out",
	"tool.path": "Path",
	"tool.path.hint": "Click two notes to trace the shortest chain between them",
	"tool.hide": "Hide",
	"tool.hide.hint": "Click removes the note from the graph",
	"tool.pin": "Pin",
	"tool.pin.hint": "Click pins or releases the note",
	"tool.depth": "Neighborhood steps",

	// ── Camera widget ─────────────────────────────────────────────────
	"camera.toggleUi": "Hide or show all panels",
	"camera.threeD": "3D",
	"camera.free": "Free",
	"camera.fit": "Fit whole graph",
	"camera.explore": "Explore",
	"camera.explore.hint": "Hop the camera from note to note along links",

	// ── Legend ────────────────────────────────────────────────────────
	"legend.min": "min",
	"legend.max": "max",
	"legend.more": "and {count} more…",

	// ── Hover tooltip ─────────────────────────────────────────────────
	"tooltip.opens": "Opens: {total} (30d: {recent})",
	"tooltip.links": "Links: ← {inbound} · → {outbound}",
	"tooltip.edited": "Edited: {date}",

	// ── Focus mode ────────────────────────────────────────────────────
	"focus.status": "Focus: {name} · depth {depth} · {count} nodes",
	"focus.exit": "Esc",
	"explore.status": "Explore: {name} · {count} links",
	"explore.open": "Open",
	"explore.open.hint": "Open this note in a new tab, without leaving the graph",
	"explore.back": "Back",
	"explore.detach": "Let go",
	"explore.detach.hint": "Space — keep exploring, but pick the next note anywhere in the vault",
	"explore.exit": "Exit",

	// ── Context menu ──────────────────────────────────────────────────
	"menu.open": "Open",
	"menu.openNewTab": "Open in new tab",
	"menu.focus": "Focus mode",
	"menu.explore": "Explore from here",
	"menu.hide": "Hide node",
	"menu.pin": "Pin position",
	"menu.unpin": "Unpin",
	"menu.copyLink": "Copy link",
	"menu.path": "Path: {path}",
	"menu.selected": "Selected: {count} notes",
	"menu.hideSelected": "Hide selected",
	"menu.copyPaths": "Copy paths to clipboard",

	// ── Notices ───────────────────────────────────────────────────────
	"notice.pathStart": "Start: {name}. Click the second note.",
	"notice.pathNone": "No link path between these notes",
	"notice.pathFound": "Path of {count} notes: {names}",
	"notice.exploreStart": "Explore mode: hover a link to see where it goes, click to travel. Backspace = back, Space = let go, Esc = leave.",
	"notice.exploreDetached": "Let go. Click any note to explore from there, Esc to leave the mode.",
	"notice.exploreNoNode": "Nothing to explore — the graph is empty",
	"notice.copiedLink": "Copied [[{name}]]",
	"notice.copiedPaths": "Copied {count} paths",
	"notice.filterPresetSaved": "Filter preset saved",
	"notice.highlighted": "Highlighted {count} notes: {layers}",
	"notice.layer.orphans": "orphans",
	"notice.layer.deadEnds": "dead ends",
	"notice.layer.broken": "broken links",
	"notice.unpinned": "Unpinned: {name}",
	"notice.pinned": "Pinned: {name}",
	"notice.pngFailed": "Could not create the PNG",
	"notice.presetApplied": "View \"{name}\" applied",
	"notice.presetOverwritten": "Preset \"{name}\" overwritten",
	"notice.presetSaved": "Preset \"{name}\" saved",
	"notice.presetDeleted": "Preset \"{name}\" deleted",
	"notice.viewStateReset": "View state reset",
	"notice.usageCleared": "Usage statistics cleared",
	"notice.dataReset": "Advanced Graph View data reset",

	// ── Prompt modal ──────────────────────────────────────────────────
	"prompt.presetTitle": "View preset name",
	"prompt.presetDefault": "My view",
	"prompt.save": "Save",
	"prompt.cancel": "Cancel",

	// ── Commands ──────────────────────────────────────────────────────
	"command.openView": "Open graph view",
	"command.ribbon": "Open Advanced Graph View",
	"command.focusNote": "Focus current note in graph",
	"command.toggleOrphans": "Toggle orphan highlight",
	"command.toggleTrail": "Toggle session trail",
	"command.toggleExplore": "Toggle explore mode",
	"command.openInsights": "Open Insights dashboard",
	"command.exportPng": "Export current view as PNG",
	"command.exportJson": "Export graph data as JSON",
	"command.exportGexf": "Export graph data as GEXF",

	// ── Insights dashboard ────────────────────────────────────────────
	"insights.title": "Graph insights",
	"insights.computing": "Computing metrics…",
	"insights.total.notes": "notes",
	"insights.total.links": "links",
	"insights.total.orphans": "orphans",
	"insights.total.broken": "broken",
	"insights.topOpens": "Top by opens (30 days)",
	"insights.topPagerank": "Top by PageRank",
	"insights.cooling": "Cooling hubs (untouched {days}+ days)",

	// ── Settings tab ──────────────────────────────────────────────────
	"settings.group.tracking": "Tracking",
	"settings.openThreshold": "Open threshold",
	"settings.openThreshold.desc":
		"How many seconds a note must stay active before the open is counted.",
	"settings.seconds": "{value} s",
	"settings.exportCsv": "Export usage as CSV",
	"settings.exportCsv.desc": "Download the open-count log as a spreadsheet-friendly file.",
	"settings.clearUsage": "Clear usage statistics",
	"settings.clearUsage.desc": "Permanently deletes the entire open-count log.",
	"settings.group.hover": "Hover preview",
	"settings.hoverEnabled": "Show note preview on hover",
	"settings.hoverEnabled.desc":
		"When hovering a node, show the first words of the note in the tooltip.",
	"settings.hoverWords": "Preview length (words)",
	"settings.hoverWords.desc":
		"How many leading words of the note body to show in the hover preview.",
	"settings.hoverDelay": "Preview delay (ms)",
	"settings.hoverDelay.desc":
		"How long to hover a node before its preview loads. 0 shows it instantly.",
	"settings.range": "Enter a number between {min} and {max}",
	"settings.group.data": "Data",
	"settings.resetAll": "Reset all plugin data",
	"settings.resetAll.desc": "Usage statistics and node positions. Settings are kept.",

	// ── Onboarding ────────────────────────────────────────────────────
	"onboarding.title": "Advanced Graph View — what is different",
	"onboarding.step1.title": "1 · Nodes encode metrics",
	"onboarding.step1.body":
		"Size = PageRank (actual importance), color = edit recency. The panel on the left reassigns the channels: opens, links, age, folders, tags, clusters.",
	"onboarding.step2.title": "2 · Layers and filters",
	"onboarding.step2.body":
		"Layers highlight orphans, dead ends and broken links. The search bar understands path:, tag:, opened:>10, edited:<30d. Double-click a node for focus mode, Shift+drag for lasso.",
	"onboarding.step3.title": "3 · Clusters and 3D",
	"onboarding.step3.body":
		"Color by Cluster to see communities, switch on 3D in the bottom-right widget to fly through the graph, and pick a color scheme in the panel.",
	"onboarding.dismiss": "Got it, do not show again",
} as const;
