# Advanced Graph View 0.10.3

Draft release preparation. Not published. CI and full native acceptance remain required before release.

This update reduces repeated work in the graph and adds optional sharper rendering.

- Panel changes update immediately and save after a short debounce. Closing the graph or quitting flushes pending settings.
- Expensive visual calculations run only when their inputs change.
- Hidden panes pause drawing. Static graphs draw on demand, with a safety frame at least every 500 ms.
- Snapshot history loads on first use. Capturing a snapshot waits for existing history.
- High-resolution rendering is optional and capped at 2x. Standard rendering stays the default.
- Repeated settings reloads clean up listeners, and PNG exports retain nodes from hidden graph tabs.

In the local 10k-node harness, static-scene drawing fell from 1788 to 59-60 renders over 30 seconds. These are draw counts, not CPU/GPU utilization measurements. Pan and zoom did not meet the 50 FPS target in this environment, including the baseline; no pan/zoom speedup is claimed.

Native checks covered pane visibility, main/local rendering after enabling high resolution, node dragging/clicking and visible PNG export. The hidden PNG fix, lasso, the complete animation route and exact position restoration after a full restart still need final native acceptance.

Requires Obsidian 1.13.0 or later. Desktop only.
