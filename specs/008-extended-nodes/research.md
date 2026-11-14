# Research

Decision: preserve three-argument builder and exact off/off result, including linked attachments. Rationale: existing runtime and regression explicitly include these targets. Alternative full attachment filtering rejected as incompatible.

Decision: unresolved identity is NUL-prefixed JSON tuple of source and linkpath, with separate display metadata. Rationale: no collision with real file paths; no speculative path resolution. Obsidian getFirstLinkpathDest resolves current targets using source context (installed 1.13.1 d.ts and official Context7 documentation checked). No automatic file creation.

Decision: optional snapshot scope defaults to legacy; invalid explicit scopes are discarded. Compare/capture only same scope, retain separate buckets with shared size cap.

Decision: optional kind preserves old structural payloads. Extended nodes are explicitly typed. File extension is checked at preview boundaries even for legacy nodes.
