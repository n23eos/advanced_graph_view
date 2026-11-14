# Advanced Graph View 0.11.2

Unpublished candidate. No tag or release is authorized.

Use prop:key=value to filter notes by frontmatter and select Property: key in the Color control. Scalar values and lists are supported, matching is case-insensitive, and missing values retain the default tint. Property changes update the graph without restarting layout. Existing default colors and presets remain unchanged.

This candidate includes workspace camera/query restoration and Cmd/Ctrl native hover integration. Final integrated verification: 983 tests / 139 files, lint zero warnings, typecheck and production build pass. Independent review closed the hidden-node count reset after property options change.

Browser QA confirmed property color in both panel modes, prop:status=active showing 8/42 notes, and restoration into a fresh view; narrow/light layout inspected. Native Obsidian restart, hover popup and popout acceptance remain unverified while macOS is locked.

Requires Obsidian 1.13.0 or later; desktop only.
