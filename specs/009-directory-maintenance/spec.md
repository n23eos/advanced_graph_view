# Feature Specification: Existing directory maintenance

**Feature Branch**: `codex/009-directory-maintenance`
**Created**: 2026-11-14
**Status**: Ready for implementation
**Input**: Hardening E5 preparation, corrected by the owner: Advanced Graph View is already published with about 9k downloads. No new submission or release.

## User Scenarios & Testing

### User Story 1 - Install the published plugin (Priority: P1)

Users find accurate instructions for installing Advanced Graph View from Community Plugins.
**Why this priority**: The existing README incorrectly says it is not listed.
**Independent Test**: Follow the documented directory name and compare the public listing.
**Acceptance Scenarios**:
1. Given the published listing, when a user reads installation instructions, then Community Plugins is the stable installation method.
2. Given an existing installation, when reading maintenance notes, then its name and internal ID remain unchanged.

### User Story 2 - Prepare a future update (Priority: P2)

The owner can review repository and directory requirements without publishing anything.
**Why this priority**: Avoid a duplicate listing or accidental release.
**Independent Test**: Inspect the prepared audit and owner checklist against current official requirements.
**Acceptance Scenarios**:
1. Given an existing listing, when preparing maintenance, then the pack targets that entry and contains no new submission request.
2. Given publication is prohibited, when preparation ends, then no tag, release, directory edit or external message was sent.

### Edge Cases

Stale listing text, a candidate version newer than the published release, an old internal ID differing from the display name, and unverified native scenarios.

## Requirements

### Functional Requirements

- **FR-001**: Keep the public name Advanced Graph View and existing internal ID graph-insight.
- **FR-002**: Correct installation and feature documentation to match the implemented behavior.
- **FR-003**: Audit manifest and documentation against current official directory requirements.
- **FR-004**: Prepare English listing text and a future owner checklist without making directory changes.
- **FR-005**: Clearly separate completed local verification from outstanding native acceptance and release actions.

### Key Entities

- Existing directory entry: stable ID, display name and repository.
- Maintenance pack: requirement audit, suggested text and deferred owner actions.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Zero references claiming the plugin is absent from Community Plugins.
- **SC-002**: Manifest retains its published name and ID, and its description meets the official length and punctuation rules.
- **SC-003**: Zero new directory submissions, tags or releases.
- **SC-004**: Documentation provides a direct stable installation route and identifies remaining acceptance checks.

## Assumptions

- Existing public listing and the owner's confirmation supersede the old E5 new-submission premise.
- Repository commits and push are authorized; release and directory changes are not.
