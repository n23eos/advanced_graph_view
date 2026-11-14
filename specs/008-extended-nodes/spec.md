# Feature Specification: Advanced Graph View extended nodes

**Feature Branch**: `codex/008-extended-nodes`
**Created**: 2026-11-14
**Status**: Approved for implementation
**Input**: E4: optional attachments and unresolved targets, preserving existing defaults.

## User Scenarios & Testing

### User Story 1 - Expand the graph (Priority: P1)
Users can include isolated attachments and missing link targets independently.
**Independent Test**: Toggle each option and compare graph membership.
**Acceptance Scenarios**:
1. Given existing settings, when the graph opens, then topology and counts remain unchanged.
2. Given an unlinked attachment, when all attachments is enabled, then it appears in main and local graph models.
3. Given a missing link, when unresolved targets is enabled, then its source connects to a distinguishable missing target.

### User Story 2 - Safely inspect and share (Priority: P1)
Users can inspect mixed graphs without treating binary files or missing targets as notes.
**Independent Test**: Hover, open, filter and export a mixed neighborhood.
**Acceptance Scenarios**:
1. Attachment hover never reads binary content as Markdown.
2. Missing targets open their existing source note or a newly resolved destination, without creating a file.
3. Exports preserve full attachment paths and display missing targets without internal identifiers.

### User Story 3 - Comparable history (Priority: P2)
Users see changes only against snapshots using the same membership options.
**Independent Test**: Switch options between captures and inspect history.
**Acceptance Scenarios**:
1. Old history remains readable under default options.
2. History from another option combination is not compared or used to block capture.

### Edge Cases
Duplicate filenames, stale cache sources, targets resolving between cache updates, hidden nodes, deleted attachments, old settings and snapshots, zero-node models.

## Requirements

### Functional Requirements
- FR-001: Both new options default off and normalize invalid values to false.
- FR-002: Off/off preserves existing graph membership, order, counts and identifiers exactly, including previously linked attachments.
- FR-003: All attachments adds existing unlinked non-Markdown files; unresolved targets retain source context and never collide with real files.
- FR-004: Main/local graph, metrics, overlays, timeline, navigation and exports handle mixed membership safely.
- FR-005: Binary and missing targets are never read as Markdown previews.
- FR-006: Snapshot retention and comparison distinguish all four membership combinations, while old payloads remain valid.
- FR-007: All twelve supported locales expose the options and missing-target wording.

### Key Entities
Node: existing note, attachment or missing target; directed weighted link; membership scope; historical snapshot.

## Success Criteria

### Measurable Outcomes
- SC-001: Default graph comparisons show zero topology/count/order differences.
- SC-002: Every exported edge has two exported endpoints and every node has a unique identifier.
- SC-003: No attachment preview performs a note-body read; no missing-target click creates a file.
- SC-004: All four option combinations have isolated historical comparisons.

## Assumptions
Previously linked attachments remain visible with options off for backward compatibility. Missing targets are source-qualified rather than guessed future paths. Native acceptance is pending while the desktop is locked. No dependency changes, preset version bump, release or publication is part of this implementation.
