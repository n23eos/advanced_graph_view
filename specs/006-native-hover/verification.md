# Verification: Native hover preview

Date: 2026-11-14.

- New helper tests initially failed because the feature was absent; three renderer routing assertions failed before the optional callback was added. TDD logs /tmp/hardening-e2-red.log and /tmp/hardening-e2-render-red.log.
- Independent review found stale stationary targets after node motion and hidden-leaf previews. Added failing regressions, then resolve the current node on modifier press and clear on visibility loss. A second reviewer confirmed both closures and ran 16 focused tests successfully. Native popup interaction is preserved when crossing from canvas into its hoverEl.
- Pre-integration full verify: 928 tests / 127 files PASS, typecheck PASS, lint zero errors/warnings. Production build PASS. Existing test changes only add registerHoverLinkSource API stubs; all original assertions preserved.
- Cmd/Ctrl is an intentional activation gate per E2. Page Preview must be enabled; this implementation continues to require the modifier even if its source preference is changed to allow unmodified hover.
- Native core-graph comparison and real popup acceptance remain unverified because macOS is locked. No native acceptance claim, tag or release.

- Integrated after E1: 959 tests / 131 files, lint zero, typecheck/build PASS. Conflicts combined both optional renderer callbacks, state/hover helpers and pending-camera autoFit guard with model preview cleanup. Logs /tmp/hardening-e2-integrated-{verify,build}.log.
