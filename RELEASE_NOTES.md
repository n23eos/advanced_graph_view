# Advanced Graph View 0.10.4

Draft release preparation. Not published. Native acceptance remains incomplete; publication is not authorized.

- New notes start near an existing neighbor when saved positions are available.
- Reduced motion makes camera flights and trail replay immediate and disables interface transitions.
- Main and local graph panes use their own window for rendering, pointer and keyboard input, timers and theme colors.
- Moving a pane recreates its renderer. Closing during a move cancels reopening, and failed persistence still releases resources.
- The manifest includes the existing Ko-fi support link.

Verification: 912 tests in 124 files, typecheck, lint with zero warnings and production build passed. Independent review fixes have regression coverage.

Popout interaction, reduced-motion appearance and the remaining native checks from earlier hardening stages are not yet accepted. The Mac was locked during these checks. This draft must not be treated as a published or natively accepted release.

Requires Obsidian 1.13.0 or later. Desktop only.
