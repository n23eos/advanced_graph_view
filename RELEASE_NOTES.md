# Advanced Graph View 0.10.1

This maintenance update improves panel layout and fixes several cases where the graph could show stale results or stop updating.

- Search filters and navigation leave room for the settings panel. The timeline fits narrow panes and sits above the lower controls.
- Search and timeline buttons use consistent icons. The settings header supports keyboard activation and announces its expanded state.
- Changing timeline dates clears the previous date filter. Playback starts at the displayed month and stops when its data changes.
- Damaged saved coordinates no longer prevent valid positions from loading. Existing two-dimensional positions remain supported.
- Failed background workers release their resources and offer the existing restart action.
- Switching the Changes period no longer lets an older calculation overwrite the selected period.
- Closing the graph during position loading no longer applies the result to a destroyed view.
- If WebGL is unavailable, a clear message explains the requirement and offers a retry.
- Empty vaults no longer fail during metrics calculation. The reset button in empty search results works again.
- Closing or rebuilding a graph no longer produces a false graphics-context warning.
- Closing one graph no longer breaks text rendering in another open graph. Edge meshes also preserve shared graphics resources.

- PNG export captures the visible viewport without allocating a huge image for offscreen nodes.

Requires Obsidian 1.13.0 or later. Desktop only.
