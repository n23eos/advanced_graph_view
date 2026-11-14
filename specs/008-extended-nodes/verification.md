# Verification: Extended nodes

Date: 2026-11-14. Branch: codex/008-extended-nodes. Base: 1542e40.

## Result
Both settings default off. The legacy three-argument model and explicit off/off retain exactly the previous membership, including already-linked attachments and legacy stale-cache behavior. All attachments adds the complete non-Markdown inventory; unresolved adds source-qualified targets after checking the current metadata resolver and live file inventory.

Main/local graphs and Insights refresh attachment inventory on vault create/delete/rename independently of Markdown metadata passes, with per-open listener cleanup. Main graph subscribes before its initial asynchronous model build. Insights resyncs its watcher when settings change, without accumulating listeners.

Main/local graphs, Insights, settings profiles, navigation, previews, exports, facts, metric inputs, date grouping, timeline and note-oriented overlays handle the extended model. JSON exposes missing identities separately from paths. Legacy linked attachments also retain full paths and real file stats without changing the legacy model. Mixed topic-map headings say nodes in all locales. Markdown exports link to the source note instead of manufacturing a missing file in the export folder. Same-scope snapshots preserve old payload compatibility and separate retention buckets; the existing global size cap still applies.

## Checks run
- New core model, scope, snapshot, export, navigation, settings/profile, grouping, Insights and inventory-listener tests were observed failing before the corresponding implementation and passing afterwards.
- Added main-view integration coverage for attachment metadata, missing dates, native preview exclusion and Markdown-only content indexing.
- npm run verify: PASS, 1012 tests in 150 files. Initial failures in four old view fixture files were resolved by supplying plugin.settings.graphScope; assertions unchanged.
- npm run build: PASS.
- Follow-up lifecycle regressions observed RED then GREEN: attachment creation during an initial pending graph build, and Insights scope-toggle/reload/create/rename/delete/reopen/close subscriptions.
- Final focused checks cover main/local integration and topic-map exports after label refinements.
- git diff --check: PASS. New/changed lines and feature documents checked for forbidden literal typographic dashes. graphChanges.ts contains no literal NUL bytes; its base version did, so Git may present that old-to-new diff as binary without --text.

## Limits
Native Obsidian UI acceptance was not run because the desktop is locked. No commit, push, release or installation was performed. Browser coverage cannot substitute for native file navigation or attachment handling.

## Manual acceptance pending
Use notes with linked and isolated attachments, same missing name in different folders, and a newly created missing target. Check all four settings combinations, source-note navigation, native hover, local graph and Markdown/JSON/GEXF export. Switch scope and check that history only compares matching scopes. Confirm settings persist and an old profile without scope does not reset the current choice.
