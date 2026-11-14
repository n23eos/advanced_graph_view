# Validation

Run `npm run verify` and `npm run build` from the repository root. New tests cover malformed state, round trips, first tick/settle, late restore, reopen, separate leaves, content queries and no physics-triggered saves.

Native acceptance: open two graph tabs, pan/zoom each differently, commit distinct searches; save/quit/restart Obsidian and compare after layout settles. Repeat in 3D and after moving to a differently sized window. A fresh tab must still auto-fit. Check that shared plugin data.json does not contain camera/query. If macOS is locked, record native acceptance as unverified rather than equating unit tests with it.
