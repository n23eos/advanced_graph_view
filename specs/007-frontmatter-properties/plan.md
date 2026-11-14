# Implementation Plan: Frontmatter properties

**Branch**: `007-frontmatter-properties` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-frontmatter-properties/spec.md`

## Summary

Extend existing node facts with optional normalized frontmatter properties, add exact `prop:key=value` query terms, and expose discovered property keys as dynamic categorical color metrics. Reuse the current panel state, preset, encoding, and refresh paths so defaults and stored data stay compatible.

## Technical Context

**Language/Version**: TypeScript 6, target ES2022

**Primary Dependencies**: Obsidian 1.13 API, PixiJS 8, existing native DOM controls

**Storage**: Existing Obsidian plugin `data.json`; no new storage collection

**Testing**: Vitest 4 with jsdom and project host stubs

**Target Platform**: Obsidian desktop and mobile plugin runtime

**Project Type**: Existing desktop and mobile plugin

**Performance Goals**: Property extraction and comparison remain linear in current graph facts and frontmatter entries; property-only refresh does not restart force layout

**Constraints**: Offline capable, no dependency changes, no default appearance change, optional facts field for compatibility, no settings or preset version bump

**Scale/Scope**: Current graph node set and frontmatter exposed by the metadata cache; 12 locale tables; two panel modes

## Constitution Check

*GATE: Passed before Phase 0 research and re-checked after Phase 1 design.*

- Existing TypeScript, Vitest, DOM, encoding, and worker boundaries are reused.
- Regression tests are required before implementation and include pure logic plus panel and graph integration.
- No performance claim is made without behavior-based checks; the design avoids layout regrouping for property-only changes.
- Existing settings, presets, defaults, and unrelated work remain intact.
- Required final checks are `npm run verify`, `npm run build`, and diff review.
- Work is local only: no install, publication, push, release, dependency, README, or version change.
- Added text uses plain hyphens and excludes U+2013 and U+2014.

Post-design re-check: all gates still pass. The design adds no subsystem, dependency, storage format, or constitution exception.

## Project Structure

### Documentation (this feature)

```text
specs/007-frontmatter-properties/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── property-query-and-color.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── encoding/
│   ├── metrics.ts
│   ├── metricLabels.ts
│   └── encode.ts
├── query/
│   └── QueryParser.ts
├── settings/
│   └── normalize.ts
├── ui/
│   └── ControlPanel.ts
├── view/
│   ├── GraphView.ts
│   └── factsRefresh.ts
└── i18n/
    ├── types.ts
    └── locales/*.ts
```

Tests remain colocated with their source modules in `src/**/*.test.ts`; this feature adds new property-focused regression files.

**Structure Decision**: Extend the current single plugin project and its colocated tests. Frontmatter normalization belongs beside node metrics as pure data logic; the graph view remains the Obsidian cache adapter and coordinator.

## Complexity Tracking

No constitution violations or justified complexity exceptions.
