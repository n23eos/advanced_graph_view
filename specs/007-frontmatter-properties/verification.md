# Verification: Frontmatter properties

Date: 2026-11-14.

- TDD baseline: 8 new files failed with 14 failing assertions before implementation; focused new tests and existing affected tests pass.
- Independent review found property options rerender reset the hidden-node count. Added RED/GREEN regression and stored count independently of DOM. Reviewer repeated 160 targeted tests, typecheck and lint; no open findings.
- Integrated after E1/E2: npm run verify PASS, 983 tests / 139 files, lint zero errors/warnings, typecheck PASS; npm run build PASS. Logs /tmp/hardening-e3-integrated-{verify,build}.log.
- Only old fixture extension is facts: [] in panelApplication test; original assertions unchanged. No dependency or preset version changes.
- Browser real GraphView/renderer/workers: Color Property: status produces reference/active legend; prop:status=active commits and shows 8 of 42; both selection and query survive fresh-view restore. Simple and Expert selectors retain the property, 360 px/light screenshot inspected, no harness error. Browser fixture supplies synthetic frontmatter and a native-hover event reporter.
- Native Obsidian property editing remains unverified while macOS is locked. No release/tag.
