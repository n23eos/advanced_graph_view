# Tasks: Existing directory maintenance

## Phase 1: Setup

- [x] T001 Record owner correction and current listing in specs/009-directory-maintenance/spec.md.

## Phase 2: Foundation

- [x] T002 Audit official requirements and record sources in specs/009-directory-maintenance/research.md.

## Phase 3: US1 - Published installation

Independent test: README directs users to the existing Advanced Graph View listing and retains its ID.

- [x] T003 [US1] Correct stable installation, self-link and support policy in README.md.
- [x] T004 [US1] Align README.md feature/default/performance/data descriptions with current code and verification.

## Phase 4: US2 - Future update preparation

Independent test: owner pack describes the existing entry and explicitly defers publication.

- [x] T005 [US2] Audit manifest.json and LICENSE without changing identity.
- [x] T006 [US2] Prepare English listing text and deferred actions in specs/009-directory-maintenance/maintenance-pack.md.

## Phase 5: Validation

- [ ] T007 Validate final integrated documentation and record results in specs/009-directory-maintenance/verification.md.

## Dependencies and execution

Setup -> requirements audit -> README and owner pack -> final diff validation. README and pack drafting can run independently after audit. No runtime change, new unit tests, submission or release. Final integration follows E4.
