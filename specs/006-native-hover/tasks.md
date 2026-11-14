# Tasks: Native hover preview

## Phase 1: Setup

- [x] T001 Create Spec Kit artifacts in specs/006-native-hover/.

## Phase 2: Foundation

- [x] T002 Add failing controller tests in src/view/nativeHoverPreview.test.ts.

## Phase 3: US1 - Preview a note

Independent test: modified hover emits exact full path; plain hover does not.

- [x] T003 [US1] Implement controller and native payload in src/view/nativeHoverPreview.ts.
- [x] T004 [US1] Add renderer routing tests in src/render/GraphRenderer.nativeHover.test.ts and optional callback in src/render/GraphRenderer.ts.
- [x] T005 [US1] Register hover source in src/main.ts and wire successful opens in src/view/GraphView.ts.

## Phase 4: US2 - Leave safely

Independent test: stationary modifier press works; each cleanup path releases the popup once.

- [x] T006 [US2] Test and implement captured host event cleanup in src/view/nativeHoverPreview.ts and its test file.
- [x] T007 [US2] Dispose controller during teardown in src/view/GraphView.ts.

## Phase 5: Validation

- [x] T008 Review, verify/build and document actual/native verification in specs/006-native-hover/verification.md.

## Dependencies and strategy

T001 -> T002 -> US1 -> US2 -> validation. Controller tests are the MVP, then integrate main/Explore routes. Renderer route tests and controller tests may run in parallel. One runtime owner per file; preserve original assertions. No release.
