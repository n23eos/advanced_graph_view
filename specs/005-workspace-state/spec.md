# Feature Specification: Workspace state

**Feature Branch**: `codex/005-workspace-state`
**Created**: 2026-11-14
**Status**: Ready for implementation
**Input**: Hardening E1: restore each graph tab's camera and committed search after restart.

## User Scenarios & Testing

### User Story 1 - Resume the same view (Priority: P1)

Users resume their graph at the same center, scale and 3D orientation after reopening a workspace.
**Why this priority**: Returning to a large graph should preserve the user's place.
**Independent Test**: Pan, zoom and rotate a graph, save and reopen its tab, then compare the camera before and after layout settles.
**Acceptance Scenarios**:
1. Given a moved camera, when the tab is restored, then the same world center, scale and orientation remain after layout settles.
2. Given two graph tabs with different cameras, when the workspace restores, then each keeps its own state.
3. Given no saved camera or an invalid one, when the graph opens, then normal automatic framing still works.

### User Story 2 - Resume committed search (Priority: P2)

Users resume the committed search independently of camera restoration.
**Why this priority**: Search defines the user's current working subset.
**Independent Test**: Restore a committed tag or content search and inspect the displayed nodes and input.
**Acceptance Scenarios**:
1. Given a valid committed search, when the tab restores, then the search input and visible subset agree, including after content indexing.
2. Given an invalid camera and valid query, when restoring, then the valid query still applies.

### Edge Cases

- Unknown state version, arrays, missing fields, non-finite coordinates, invalid scale or malformed query.
- State arriving before initialization or after the graph is ready.
- Internal renderer recreation, popout migration and changing window dimensions.
- A newer restore request arriving during asynchronous initialization.

## Requirements

### Functional Requirements

- **FR-001**: Preserve camera and committed search separately for each graph tab in the workspace.
- **FR-002**: Do not store tab state in shared plugin settings or overwrite another tab's state.
- **FR-003**: Automatic framing and the first layout update must not overwrite a valid restored camera.
- **FR-004**: Ignore unsupported or invalid state fields without preventing valid fields from restoring.
- **FR-005**: Keep existing appearance and automatic framing for tabs without saved state.
- **FR-006**: Camera interaction and committed search request workspace persistence; graph animation alone must not cause repeated saves.
- **FR-007**: Preserve the latest state across internal renderer recreation; cancel timers belonging to a closed window.

### Key Entities

- Tab state: version, optional camera and optional committed query.
- Camera: world center, scale, reference scale and 3D position, pivot and orientation.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Both 2D and 3D camera round trips preserve valid coordinates and orientation within floating point tolerance.
- **SC-002**: Two tabs retain two distinct cameras and queries after restoration.
- **SC-003**: Invalid-state cases produce no crash and leave valid independent fields usable.
- **SC-004**: One hundred layout ticks without interaction cause zero workspace save requests.

## Assumptions

- Desktop Obsidian owns workspace persistence; existing panel settings still own the 2D/3D mode.
- Existing content search semantics are retained. No history or uncommitted search is persisted.
- Native restart acceptance is reported separately when the host UI is unavailable.
