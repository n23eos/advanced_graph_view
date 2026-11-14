# Advanced Graph View 0.12.0

Unpublished candidate. No tag or release is authorized.

Optional settings add all attachments and missing link targets to the graph. Both switches start off, preserving the existing default graph, including already-linked attachments. Missing targets open their source note and never create files automatically. Main graph, local graph, Insights, exports and Changes history handle the selected scope. Attachment exports retain full paths and file facts use actual timestamps.

This candidate includes the hardening fixes, reduced idle rendering, owner-window handling, workspace camera/query restoration, Cmd/Ctrl native hover integration and frontmatter property filtering/color.

Verification: 1012 tests / 150 files, lint zero warnings, typecheck and production build pass. Independent review closed. Browser QA confirmed all four node-scope combinations, return to baseline, property filtering and fresh-view restoration; narrow/light and wide/dark screenshots inspected.

Native restart, hover popup, popout and attachment navigation acceptance remain unverified while macOS is locked. Performance limits are recorded in specs/004-hardening/verification.md. This candidate is not a published release.

Requires Obsidian 1.13.0 or later; desktop only.
