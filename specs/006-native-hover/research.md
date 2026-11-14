# Research

Decision: registerHoverLinkSource with display equal to manifest.name and defaultMod true. Source: installed obsidian.d.ts and Context7 /obsidianmd/obsidian-api (2026-11-14).

Decision: workspace.trigger("hover-link", {event, source, hoverParent, targetEl, linktext}). Full vault path prevents basename ambiguity. Official payload example: https://docs.obsidian.md/plugins/guides/bases-view . Native comparison with core graph remains unverified while Mac is locked.

Decision: HoverParent has hoverPopover; public HoverPopover extends Component and supports unload(), not an undocumented hide method. Reuse one parent per open view session.

Decision: optional onNodePreview callback rather than adding a fourth argument to existing hover callbacks, preserving old API/test contracts.

Decision: custom tooltip remains. Native popup interaction is allowed while pointer is inside its hoverEl; leaving to unrelated content or starting a graph gesture closes it.
