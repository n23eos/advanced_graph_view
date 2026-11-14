# Tasks: Extended nodes

## Setup
- [x] T001 Read skills and create specs/008-extended-nodes artifacts.
## Foundation and US1
- [x] T002 [US1] Add RED model/scope/settings tests in src/data/extendedNodes.test.ts.
- [x] T003 [US1] Implement src/data/GraphStore.ts, graphScope.ts, vaultGraph.ts and settings normalization.
## US2
- [x] T004 [US2] Add safe navigation/preview/export regressions in src/view/extendedNodes.test.ts.
- [x] T005 [US2] Integrate src/view, src/export, src/analysis mixed-node consumers.
- [x] T006 [US2] Add controls and all twelve src/i18n/locales translations.
## US3
- [x] T007 [US3] Add snapshot scope regressions in src/data/graphSnapshots.scope.test.ts.
- [x] T008 [US3] Integrate src/data/graphSnapshots.ts, src/main.ts and changesController.
## Validation
- [x] T009 Run verify/build and record results in specs/008-extended-nodes/verification.md.

Dependencies: T001 -> T002/T003 -> T004/T005/T006 and T007/T008 -> T009. One implementation owner; no parallel edits. MVP is US1, but authorized delivery includes all stories. Native acceptance remains pending locked desktop.
