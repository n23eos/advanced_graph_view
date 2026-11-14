# Validation

Run npm run verify and npm run build. New tests cover plain/modified hover, repeated target deduplication, full paths, stationary modifier activation, release/leave/drag/blur/disposal and main/Explore callback routes.

In native Obsidian enable Page preview, hover a node normally then with Cmd/Ctrl, move into its preview, release modifier, drag, switch windows and close graph. Compare to core graph and verify custom tooltip remains. Native acceptance is not implied by a synthetic event test.
