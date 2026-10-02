Explore can now jump to a note by name or path, or by clicking its visible node. These choices preserve the route and respect active filters.

### Explore navigation

- **Choose note** opens a searchable picker. Type a note name or path, then press Enter or click a result. Full paths distinguish notes with the same name.
- Click any visible node to make it the center without leaving Explore or letting go first.
- The picker, Back button and breadcrumbs remain available after **Let go**.
- Back skips hidden or deleted destinations. Selecting a hidden breadcrumb no longer moves the history cursor without moving the camera.
- Hovering an unrelated node shows its name without arming a link transition.

### Runtime fixes

- Graph updates detect changed links and weights even when node and edge counts stay the same.
- Active content filters refresh after vault changes. Cancelled scans clear their indexing status without publishing stale results.
- Metric calculations discard obsolete results when a newer graph is waiting.
- Grouping and reheat commands keep disabled physics frozen.
- Layout skips collision-tree work when collision spacing is off. Force order and positive-radius behavior are preserved.

### Validation and compatibility

- 683 automated tests pass, alongside TypeScript, lint and the production build.
- Explore interactions were checked in a browser harness, including a 360 px panel. The native Obsidian UI has not been visually verified.
- Requires desktop Obsidian 1.13.0 or newer. Existing settings are preserved.

Install or update through Obsidian Community Plugins. For manual installation, download **main.js**, **manifest.json** and **styles.css** from this release into `.obsidian/plugins/graph-insight/`, then reload the plugin.

[Full changelog](https://github.com/n23eos/advanced_graph_view/compare/0.9.0...0.10.0)
