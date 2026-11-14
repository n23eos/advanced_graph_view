# Feature Specification: Native hover preview

**Feature Branch**: `codex/006-native-hover`
**Created**: 2026-11-14
**Status**: Ready for implementation
**Input**: Hardening E2: native note preview when hovering a graph node with Cmd/Ctrl.

## User Scenarios & Testing

### User Story 1 - Preview a note (Priority: P1)

Users hold Cmd/Ctrl over a graph node to preview its note through Obsidian without navigating away.
**Why this priority**: Reuse familiar note preview while preserving graph context.
**Independent Test**: Hover a note node with the modifier and verify the preview refers to its full vault path.
**Acceptance Scenarios**:
1. Given a note node, when hovering with Cmd/Ctrl, then native note preview is requested and the existing graph tooltip still works.
2. Given no modifier, when hovering, then existing graph tooltip behavior is unchanged.
3. Given two notes sharing a basename, when hovering one, then its exact path identifies the preview.

### User Story 2 - Leave preview safely (Priority: P2)

Users can leave a node, release the modifier, drag or close the graph without retaining a stale preview.
**Why this priority**: Hover must not interfere with navigation or leak resources.
**Independent Test**: Hover, change targets, start a drag and close or move the graph between windows.
**Acceptance Scenarios**:
1. Given an active preview, when starting another interaction or closing the graph, then the preview is disposed.
2. Given a stationary pointer over a note, when pressing Cmd/Ctrl, then the note can be previewed without requiring another mouse movement.

### Edge Cases

Empty space, Explore mode, missing file, duplicate names, modifier release, window blur and stale events from a former window.

## Requirements

### Functional Requirements

- **FR-001**: Offer native preview under Cmd/Ctrl for a valid note target in the main graph and Explore.
- **FR-002**: Preserve the existing tooltip and graph interactions.
- **FR-003**: Register a named hover source and use the full vault path.
- **FR-004**: Each graph view owns its preview lifecycle; cleanup on leave, drag, modifier release, blur and teardown.
- **FR-005**: Repeated motion on the same target must not recreate or unload the preview on every event.

### Key Entities

- Hover target: node identity and full note path.
- Preview session: source graph, host element and currently active native preview.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Both main graph and Explore request the correct note for modified hover.
- **SC-002**: Plain hover requests zero native previews.
- **SC-003**: Each tested exit path releases the active preview exactly once.
- **SC-004**: One hundred movements on the same target cause one preview request.

## Assumptions

- Obsidian's Page preview capability must be enabled for the native popup to appear.
- Native comparison with the core graph is separate acceptance when macOS is unlocked.
- No custom preview UI, new setting or appearance change is introduced.
