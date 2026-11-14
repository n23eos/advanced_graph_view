# Advanced Graph View 0.10.2

Draft release preparation. Not published. Final native acceptance of position restoration after a full restart and CI are still required.

This maintenance update fixes settings migration, stale graph data and persistence around renaming and shutdown.

- Physics settings migrate once. Later adjustments remain unchanged on restart, and imported profiles retain their migration version.
- Restored background graph tabs no longer expose commands before the view has loaded. PNG, JSON and GEXF exports require a loaded graph.
- Vault changes arriving during a rebuild trigger a follow-up rebuild.
- Tags, edit times, sizes and usage facts refresh even when links have not changed. Existing PageRank and cluster results remain available.
- Renaming notes preserves their positions and pins, including quick chains of renames and quitting before a rebuild finishes.
- Application quit waits for usage and valid position writes. Pending writes are serialized, and empty pre-layout buffers cannot overwrite saved coordinates.
- Note previews correctly remove frontmatter with Windows line endings.

Known limitation: renaming a note while the graph is closed does not migrate its saved position.

Requires Obsidian 1.13.0 or later. Desktop only.
