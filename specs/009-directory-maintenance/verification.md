# Verification: Existing directory maintenance

2026-11-14.

- Existing Community Plugins entry is Advanced Graph View, ID graph-insight, about 9k downloads. The owner confirmed this and the public listing was checked. The outdated new-submission premise in hardening E5 is superseded.
- README documents stable Community Plugins installation, existing BRAT/manual methods, corrected defaults, measured performance limits, property filters/color, workspace state, previews and optional node scopes.
- Manifest name/ID unchanged; description is 119 characters, ends with a period and stays below 250 characters. Existing desktop flag, author, minAppVersion and fundingUrl remain intact.
- README contains no obsolete absence claim, Graph Insight self-link or donation links. Support is retained through manifest fundingUrl.
- Literal U+2013/U+2014 scan of README and all spec009 documents PASS. git diff --check PASS. Private notes remain excluded through the existing escaped !notes pattern; no tracked private-note paths were found.
- No new submission, listing edit, external message, tag or release was made. Candidate documentation does not imply publication.
- Independent documentation review found three wording omissions: explicit export file writes, stable manual installation versus BRAT beta, and the exact existing-entry refresh action. All three are corrected.
- Final integrated runtime checks: pending.
