# Tasks: Workspace state

Input: spec.md, plan.md, research.md, data-model.md, contracts/workspace-state.md.

## Phase 1: Setup

- [x] T001 Create approved scope and validation artifacts in specs/005-workspace-state/.

## Phase 2: Foundation

- [x] T002 Add failing malformed-state tests and pure normalization in src/view/workspaceState.ts and its test file.

## Phase 3: US1 - Resume camera

Independent test: 2D/3D round trips, two leaves and first layout update preserve the restored camera.

- [x] T003 [US1] Add camera round-trip/resize regression tests in src/render/.
- [x] T004 [US1] Implement capture/restore and interaction callback in src/render/GraphRenderer.ts and src/render/Viewport.ts.
- [x] T005 [US1] Add pending, late and reopen restoration tests in src/view/.
- [x] T006 [US1] Implement per-leaf state and host-window save debounce in src/view/GraphView.ts.

## Phase 4: US2 - Resume committed query

Independent test: valid tag/content search restores even when camera is invalid.

- [x] T007 [US2] Add query restoration and independent validation tests in src/view/.
- [x] T008 [US2] Connect committed query restore, content indexing and save notifications in src/view/GraphView.ts.

## Phase 5: Cross-cutting validation

- [x] T009 Review changes and run npm run verify/build; record evidence in specs/005-workspace-state/verification.md.
- [x] T010 Exercise available UI scenarios and record native gaps in specs/005-workspace-state/verification.md.

## Dependencies and execution

T001 -> T002 -> US1 -> US2 -> validation. US1 is the MVP; US2 is independently testable after normalization. Unit renderer tests and pure normalization tests can run in parallel, but GraphView has one owner. Add tests before implementation; preserve original assertions. No release/tag.
