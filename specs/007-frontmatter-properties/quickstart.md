# Quickstart: Verify frontmatter properties

## Automated verification

From the repository root:

```bash
npm run verify
npm run build
```

Focused property checks are listed in `tasks.md` and cover extraction, query parsing, encoding, normalization, panel choices, refresh comparison, graph integration, and locale parity.

## Manual Obsidian scenario

1. Create three notes in a test vault.
2. Give two notes `status: active`, with one using a list containing `active`; give the third `status: done`.
3. Open Graph Insight and enter `prop:status=active`.
4. Confirm only the first two notes remain.
5. Enter `-prop:status=active` and confirm only the third note remains.
6. Clear the query and choose the `status` property in the simple color selector.
7. Confirm active and done use stable categories and the legend names `status`.
8. Switch to expert mode and confirm the same property remains selected.
9. Edit a note from `active` to `done` while the graph is open.
10. Confirm its color or filter result updates without a force-layout regroup.
11. Save and apply a view preset, close and reopen the graph, and confirm the property choice survives.

## Expected compatibility

- A graph with no selected property looks identical to the prior version.
- Existing static metric selections and queries keep their behavior.
- Notes without the selected property use the default tint.
- Removing all current uses of a saved property does not hide or discard the active selection.

## Verification record

Recorded on 2026-11-14.

- TDD RED: 8 test files failed, with 14 failed tests and 5 passing tests before production implementation.
- Focused new regressions plus locale parity: 9 test files and 64 tests passed.
- Existing affected-module regressions: 10 test files and 160 tests passed.
- First full verify exposed one incomplete legacy GraphView fixture. Adding its required empty `facts` field fixed the fixture without changing assertions.
- Final `npm run verify`: lint and typecheck passed; 132 test files and 936 tests passed.
- Final `npm run build`: TypeScript and production esbuild completed successfully.
- jsdom emitted its existing canvas `getContext` notices during the full run; they did not fail tests.
- Native Obsidian manual UI execution was not performed in this isolated feature worktree. The jsdom panel tests cover both modes, option updates, and persisted active keys.
