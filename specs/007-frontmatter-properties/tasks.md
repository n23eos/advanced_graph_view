# Tasks: Frontmatter properties

**Input**: Design documents from `/specs/007-frontmatter-properties/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Regression tests are required and must be run in a failing state before implementation.

## Phase 1: Setup and baseline

**Purpose**: Confirm feature context and preserve the existing project baseline.

- [x] T001 Confirm the clean feature baseline and shared `node_modules` symlink without reinstalling dependencies
- [x] T002 Validate `specs/007-frontmatter-properties/spec.md` with `checklists/requirements.md`

---

## Phase 2: Foundational property model

**Purpose**: Define the shared normalized property model used by every story.

- [x] T003 [P] Add failing extraction and dangerous-key regressions in `src/encoding/frontmatterProperties.test.ts`
- [x] T004 [P] Add failing dynamic metric regressions in `src/encoding/propertyMetric.test.ts`
- [x] T005 Implement property normalization and key discovery in `src/encoding/frontmatterProperties.ts`
- [x] T006 Implement dynamic property metric helpers and computation in `src/encoding/metrics.ts` and `src/encoding/metricLabels.ts`

**Checkpoint**: Normalized property facts and dynamic categorical metrics are available to queries, UI, and graph integration.

---

## Phase 3: User Story 1 - Filter by property value (Priority: P1)

**Goal**: Support exact positive and negative `prop:key=value` graph filters.

**Independent Test**: Parse and match scalar, list, case-insensitive, quoted, negated, missing, and malformed property terms.

### Tests for User Story 1

- [x] T007 [US1] Add failing property query regressions in `src/query/QueryParser.properties.test.ts`

### Implementation for User Story 1

- [x] T008 [US1] Implement property query parsing, validation, and matching in `src/query/QueryParser.ts`

**Checkpoint**: Property queries work independently against normalized node facts.

---

## Phase 4: User Story 2 - Color by property (Priority: P1)

**Goal**: Offer current property keys in both color selectors and persist valid dynamic property metrics.

**Independent Test**: Build panel controls with discovered and absent active keys, select them in both modes, normalize stored state and presets, and produce categorical encoding.

### Tests for User Story 2

- [x] T009 [P] [US2] Add failing panel option regressions in `src/ui/ControlPanel.properties.test.ts`
- [x] T010 [P] [US2] Add failing settings and preset regressions in `src/settings/propertyMetricNormalize.test.ts`
- [x] T011 [P] [US2] Add failing locale label regressions in `src/encoding/propertyMetricLabel.test.ts`

### Implementation for User Story 2

- [x] T012 [US2] Add dynamic property options and updates in `src/ui/ControlPanel.ts`
- [x] T013 [US2] Accept valid property color metrics and reject malformed ids in `src/settings/normalize.ts`
- [x] T014 [US2] Add the parameterized property metric key to the English-derived translation type through all 12 files under `src/i18n/locales/`

**Checkpoint**: Property color is selectable, encoded, labeled, and persisted with defaults unchanged.

---

## Phase 5: User Story 3 - Refresh after metadata changes (Priority: P2)

**Goal**: Build and refresh property facts without unnecessary layout regrouping.

**Independent Test**: Compare equivalent and changed maps, build facts from metadata cache, and observe property option and encoding updates after refresh.

### Tests for User Story 3

- [x] T015 [P] [US3] Add failing deep comparison regressions in `src/view/factsRefresh.properties.test.ts`
- [x] T016 [US3] Add failing graph integration regressions in `src/view/GraphView.properties.test.ts`

### Implementation for User Story 3

- [x] T017 [US3] Deep-compare optional property maps in `src/view/factsRefresh.ts`
- [x] T018 [US3] Extract metadata properties and refresh control options in `src/view/GraphView.ts`

**Checkpoint**: Initial graph construction and live metadata refresh keep property filters and color choices current without regrouping.

---

## Phase 6: Polish and verification

**Purpose**: Validate compatibility and complete feature evidence.

- [x] T019 Run all focused new regression files and relevant existing module tests
- [x] T020 Run `npm run verify`
- [x] T021 Run `npm run build`
- [x] T022 Review the full diff, confirm defaults and built-in versions are unchanged, and scan added files for U+2013 and U+2014
- [x] T023 Record actual checks and limitations in `specs/007-frontmatter-properties/quickstart.md`

---

## Dependencies and execution order

### Phase dependencies

- Phase 1 establishes the baseline.
- Phase 2 blocks all stories because every story consumes normalized properties and dynamic metric ids.
- User Story 1 and User Story 2 can proceed after Phase 2.
- User Story 3 integrates the shared model and panel behavior after the preceding foundations.
- Phase 6 depends on all selected stories.

### Within each user story

- Add regression tests first.
- Run them and record the expected failure.
- Implement the smallest production change that satisfies the contract.
- Re-run focused tests before moving to full verification.

### Parallel opportunities

- T003 and T004 target independent regression files.
- T009, T010, and T011 target independent regression files.
- T015 can be prepared independently of graph integration test T016.
- Locale table edits are mechanical after the English contract and translation key compile.

## Implementation strategy

### MVP first

1. Complete normalized property facts and query filtering.
2. Validate User Story 1 independently.
3. Add color selection and persistence.
4. Add live graph refresh integration.

### Compatibility guardrails

- Keep `NodeFacts.properties` optional.
- Keep default settings and built-in presets unchanged.
- Do not add dependencies or change release metadata.
- Do not modify `specs/004-hardening/plan.md`.
- Do not alter existing test assertions.
