# Advanced Graph View 0.11.0-beta.1

Unpublished beta candidate. Release and BRAT publication are not authorized.

This candidate organizes GraphView into seven controllers: exports, menus, note navigation, presets and tasks, Changes, tooltips and Explore. Existing behavior, settings and data formats are preserved.

Verification: all 912 existing tests in 124 files, typecheck, lint with zero warnings and production build pass. Each controller was committed separately. Independent review covered every extraction.

Browser checks use the real graph and workers with a synthetic Obsidian host: Explore entry/detach/exit, note navigation, search, task presets and Undo, Changes, empty-vault remount, narrow and light layouts. This is not full native Obsidian acceptance. The actual fuzzy note picker is unsupported by the browser adapter.

Native popout, restart persistence and the complete release-readiness route remain open while the Mac is locked. No beta or release has been published.

Requires Obsidian 1.13.0 or later. Desktop only.
