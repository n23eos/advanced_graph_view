## What's new since 0.10.1

Hover over a note to see its immediate neighborhood. A ring marks the note under the pointer, smaller markers identify its neighbors, and brighter lines show how they connect. Move the pointer away to bring the whole graph back into view.

### Reading and moving through the graph

- Color schemes now have distinct glow effects. Galaxy uses round nodes, curved links carry colors from their endpoints, and optional folder labels help identify groups. Labels stay sharp on high-DPI displays and appear according to zoom in 2D and projected node size in 3D.
- Direct neighbors follow shorter drags. A brief pulse runs along active links on hover or drag. Resizing nodes keeps a settled layout in place.
- Start the fullscreen screensaver beside the mode selector. The camera travels between connected notes, pauses on each title and lights up its links. Pause the tour or press Esc to return to your previous view.
- The settings panel shows controls for the active 2D or 3D mode. New tabs use the updated styling, while restored tabs and saved presets keep their appearance.

### Finding notes and restoring your workspace

- Filter by frontmatter with queries such as `prop:status=active` or `-prop:team=design`. Filters also match entries in list properties. Choose a scalar property to color nodes by its value.
- Optionally include attachments and unresolved link targets in the main graph, local graph and Insights. Both options start off. Inspecting a missing target does not create a file.
- Hold Cmd on macOS or Ctrl on Windows or Linux while hovering over a note to request Obsidian's native preview.
- Each graph tab restores its camera and applied search query when you reopen your workspace. New notes appear near neighbors that already have positions.

### Performance and fixes

- Hidden panes pause rendering, settled graphs redraw on demand, and snapshot history loads when needed. An optional high-resolution rendering mode supports up to 2x.
- Large 3D layouts spend less time calculating repulsion during their early steps. Curved links reuse projected endpoints and share vertices between adjacent segments during zoom. In a 5,000-node benchmark, the final optimization reduced time to settle from 10.46 to 9.54 seconds compared with beta.4. Median zoom frame rate was about 60 FPS in both runs.
- Pins and positions survive note renames more reliably. Pending settings, usage and layout changes are flushed on close or quit, and vault edits received during a graph rebuild are picked up afterward.
- PNG export preserves labels and works from hidden graph tabs. Graphs moved between windows use the destination window for rendering and input. Camera flights, trail replay and link pulses respect reduced motion.

Requires Obsidian Desktop 1.13.0 or later.

[Full comparison with 0.10.1](https://github.com/n23eos/advanced_graph_view/compare/0.10.1...0.12.0)
