# Verification: Workspace state

Date: 2026-11-14.

- TDD failures verified for missing state normalization, viewport/renderer snapshot APIs, view restoration, interaction save, first-fit ordering, internal reopen and task query reset.
- Independent architectural review found and closed three lifecycle gaps: setState before queued teardown, canceled content scans reused after reopening, and restored 2D center shifting when a hidden 1x1 canvas resizes. Dedicated RED/GREEN regressions added; reviewer repeated 31 focused tests successfully.
- Full npm run verify: 943 tests / 128 files PASS, typecheck PASS, lint zero errors/warnings. npm run build PASS. Logs: /tmp/hardening-e1-verify.log and /tmp/hardening-e1-build.log.
- Existing tests changed only to extend renderer/API fixtures; assertions preserved. No dependency/data.json schema changes.
- Browser harness uses real GraphView, renderer and workers. A committed tag:graph query restored into a fresh view, input and Shown: 6 of 42 agreed. 3D orbit yaw 0.5/pitch 0.25 and exact camera position/pivot survived recreation. 2D pan/zoom center 22.246572009659076,-20.110326220615608, scale 4.604517483380625 and referenceScale 1.8320542590386308 matched before/after exactly. Screenshot inspected. New visible Save and reopen tab control exercises public state APIs, with host workspace save stub.
- First browser error was from the Phantom wallet extension redefining ethereum; console source URL chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/evmAsk.js confirmed it. Fresh view cleared the error panel; no plugin error observed.
- Native workspace.json restart, popout and full app acceptance remain unverified: macOS is locked. Browser recreation is not a native restart claim. No release/tag.
