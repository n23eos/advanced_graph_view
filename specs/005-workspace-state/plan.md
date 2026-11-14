# Implementation Plan: Workspace state

**Branch**: `codex/005-workspace-state` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

## Summary

Use Obsidian per-view workspace state. Normalize independent camera/query fields, restore after mode application, and debounce workspace save requests on user interaction.

## Technical Context

TypeScript 6.0, Obsidian API 1.13.1, PixiJS 8.19. Existing desktop plugin and worker layout; Vitest/jsdom tests. Storage: workspace state only. No new dependencies. Camera capture is constant size; no writes during physics ticks. Scope: main GraphView, its renderer and viewport.

## Constitution Check

Before research and after design: PASS. Preserve stack, settings and old test assertions; add TDD regressions. Required verify/build and available UI checks. User 2026-11-14 explicitly authorizes commit/push/Raincoat install, superseding earlier local-only restriction. No tag/release. Native gaps must remain visible.

## Project Structure

- `src/view/GraphView.ts`: getState/setState, pending restore, lifecycle and save debounce.
- `src/view/workspaceState.ts`: pure state normalization.
- `src/render/GraphRenderer.ts`, `src/render/Viewport.ts`: camera capture/restore and interaction notification.
- Colocated new tests for normalization, rendering and view lifecycle.
- This directory: research, data-model, contracts, quickstart and tasks.

## Implementation Strategy

Add failing tests before implementation. Restore query independently, ensure content index after model readiness. Apply camera after apply3D and cancel autoFit; internal reopen snapshots current state while a newer external setState takes priority. Request layout save on interaction, never on simulation projection. Review, full verify/build and commit before the next feature.
