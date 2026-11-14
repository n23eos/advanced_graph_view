# Implementation Plan: Extended nodes

Branch: codex/008-extended-nodes. Date: 2026-11-14. Spec: [spec.md](spec.md).

## Summary
Preserve legacy graph construction; add opt-in inventory and source-qualified missing targets. Carry optional membership scope with models and snapshots. Centralize display and safe file lookup, then integrate all consumers.

## Technical Context
TypeScript 6, Obsidian 1.13.1, existing Pixi 8.19 and graphology workers. Existing settings/snapshot storage. Vitest and project verify/build. Desktop/mobile Obsidian; offline, no new dependencies. Work linear in nodes and links, no attachment-body scanning.

## Constitution Check
PASS before and after design: preserve stack, private notes ignored, no external publication, TDD and project checks required. Native UI acceptance pending locked desktop.

## Project Structure
Core: src/data/GraphStore.ts, graphScope.ts, vaultGraph.ts, graphNodes.ts, graphSnapshots.ts.
Consumers: src/view, src/export, src/analysis, src/settings, src/main.ts, src/i18n/locales.
New adjacent regression tests. Existing assertions preserved.

## Delivery
1. Core model/scope/settings tests RED, implementation GREEN.
2. Consumer integration and scope history tests RED, implementation GREEN.
3. All locales, verify/build, diff audit and acceptance notes.

## Status
Implementation and automated validation complete. 1012 tests across 150 files pass; build passes. See verification.md. No commit, push or native verification performed.
