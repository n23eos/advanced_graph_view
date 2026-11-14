# Advanced Graph View 0.11.0

Unpublished candidate. No tag or release is authorized.

Graph tabs now restore their camera and committed query through workspace state. Each tab remains independent, and the first layout fit no longer overwrites a restored camera. Internal recreation preserves the latest state, including content search and hidden-pane resize.

Verification: 943 tests / 128 files, lint zero warnings, typecheck and production build pass. Independent review closed lifecycle issues. Browser checks confirm exact 2D/3D camera and query round trips through a fresh real GraphView.

Native app restart/popout acceptance remains open while macOS is locked. Browser checks do not replace native acceptance. Requires Obsidian 1.13.0 or later; desktop only.
