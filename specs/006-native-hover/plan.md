# Implementation Plan: Native hover preview

**Branch**: `codex/006-native-hover` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

## Summary

Register the plugin hover source. Add an optional renderer preview callback, keeping existing three-argument tooltip callbacks intact. A per-open-session controller owns HoverParent and captured host window listeners.

## Technical Context

TypeScript 6.0, Obsidian API 1.13.1, existing PixiJS 8.19 renderer; Vitest/jsdom. Desktop only, no storage/dependency change. O(1) hover state; repeated pointer motion does not emit repeated requests.

## Constitution Check

Pre/post design PASS. Preserve existing behavior and assertions; new regression tests first. Verify/build, independent review and available UI checks. Commit/push/install authorized 2026-11-14. No release/tag/submission. Native core-graph comparison remains open if Mac is locked.

## Project Structure

- src/view/nativeHoverPreview.ts and tests: per-view native preview and cleanup.
- src/render/GraphRenderer.ts and new tests: optional preview callback, existing callbacks unchanged.
- src/view/GraphView.ts: attach to successful renderer open and dispose on teardown.
- src/main.ts: registerHoverLinkSource with plugin display name and defaultMod true.

## Implementation Strategy

TDD helper and renderer routes, integrate only after successful init. Cmd/Ctrl gating and keydown support for stationary pointer. Close on interaction/blur/destroy; allow entry into the actual native popup. No navigation or vault writes. Implement in isolated worktree, integrate after E1 before E3.
