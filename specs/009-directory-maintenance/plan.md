# Implementation Plan: Existing directory maintenance

**Branch**: `codex/009-directory-maintenance` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

## Summary

Correct the stale README and prepare an audit pack for the existing Advanced Graph View listing. E5 new-submission premise is superseded by owner confirmation and public directory evidence.

## Technical Context

Existing TypeScript desktop plugin, Markdown documentation and JSON manifest. No new runtime, storage or dependencies. Validation: manifest parse/field checks, link/source comparison, diff and forbidden-character scan. Runtime verify/build belongs to final integrated code.

## Constitution Check

PASS before/after design: preserve name/ID/data/dependencies, keep private notes excluded, use current official requirements. User authorizes repository push and installation, forbids release. No directory edit or submission is performed.

## Project Structure

README.md installation/features/privacy/data wording; specs/009-directory-maintenance contains the specification, research, model, contract, validation, tasks and maintenance pack. Existing manifest is audited, not renamed.

## Strategy

Apply minimal documentation corrections, remove donation links from README per current official policy while keeping fundingUrl, correct unsupported performance/default claims using actual code and measurements. Integrate after E4, run final checks and commit independently.
