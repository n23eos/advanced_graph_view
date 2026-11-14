# Feature Specification: Frontmatter properties

**Feature Branch**: `007-frontmatter-properties`

**Created**: 2026-11-14

**Status**: Ready

**Input**: Use note frontmatter properties as exact graph filters and categorical color channels without changing the default graph appearance.

## User Scenarios & Testing

### User Story 1 - Filter by property value (Priority: P1)

A user searches the graph with `prop:key=value` to keep notes whose frontmatter property contains that value. Property keys and values are compared without case sensitivity, and a leading minus negates the filter.

**Why this priority**: Exact filtering is the direct way to find graph subsets described by structured note metadata.

**Independent Test**: Add scalar and list properties to several notes, run positive and negative property queries, and verify the matching node set.

**Acceptance Scenarios**:

1. **Given** notes with scalar frontmatter values, **When** the user enters `prop:status=active`, **Then** only notes whose `status` value equals `active` without case sensitivity remain.
2. **Given** a note with a list property, **When** any list item equals the requested value, **Then** the note matches.
3. **Given** a property query prefixed with `-`, **When** the graph is filtered, **Then** matching notes are excluded.
4. **Given** a malformed property query, **When** the query is validated, **Then** the search UI reports a bad value instead of silently applying an empty property filter.

---

### User Story 2 - Color by property (Priority: P1)

A user selects an available frontmatter property from the color controls. Notes receive categorical colors from the first normalized property value, while notes without a usable value keep the default node color.

**Why this priority**: Property color reveals structured categories across the full graph without requiring tags or folders.

**Independent Test**: Select a property in either panel mode and verify stable categorical colors, the legend label, and the saved selection after rebuilding the panel.

**Acceptance Scenarios**:

1. **Given** graph notes with usable properties, **When** the user opens a color selector, **Then** available property keys are offered in a deterministic order.
2. **Given** a selected property, **When** graph encoding runs, **Then** the first normalized value determines the category and the legend identifies the property key.
3. **Given** a saved property key that is absent from current notes, **When** the panel is rebuilt, **Then** the saved key remains selectable and active.
4. **Given** no property color is selected, **When** the feature is available, **Then** the default graph appearance remains unchanged.

---

### User Story 3 - Refresh after metadata changes (Priority: P2)

A user edits frontmatter while the graph is open. The graph refreshes filtering and property color data without regrouping the force layout when only property values changed.

**Why this priority**: Open graph views must reflect current metadata and avoid unnecessary movement.

**Independent Test**: Change only a frontmatter property and verify that facts and encoding update while grouping remains unchanged.

**Acceptance Scenarios**:

1. **Given** an open graph, **When** a note property changes, **Then** the node facts and available property keys refresh.
2. **Given** only property values changed, **When** facts are compared, **Then** visual encoding is recomputed without triggering layout regrouping.
3. **Given** equivalent normalized properties are rebuilt as new objects, **When** facts are compared, **Then** no false change is reported.

### Edge Cases

- Missing, null, empty, object, and nested object values are ignored.
- Finite numbers and booleans remain usable, including `0` and `false`.
- Arrays keep supported scalar items and ignore unsupported items.
- Property keys are trimmed and compared without case sensitivity.
- Obsidian parser metadata such as `position` is not exposed as a property.
- Keys that can affect object prototypes are stored and read as ordinary data without mutating prototypes.
- An absent property never matches a positive property query.
- Existing settings and presets with static metric ids remain valid.
- A malformed saved property metric falls back to the existing default color channel.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST extract usable scalar and list frontmatter values into node facts while keeping property facts optional for compatibility with existing callers.
- **FR-002**: The system MUST normalize property keys and string comparisons without case sensitivity and MUST ignore unsupported values and host metadata.
- **FR-003**: The system MUST parse and validate `prop:key=value` terms, including negation and quoted values containing spaces.
- **FR-004**: A property filter MUST match an exact normalized value and MUST match when any normalized list item equals the requested value.
- **FR-005**: The color controls in both panel modes MUST offer discovered property keys and MUST retain an active saved property key even when it is not currently discovered.
- **FR-006**: A selected property color MUST use the first normalized value as a categorical value and MUST leave nodes without a value on the default color.
- **FR-007**: Property metric labels MUST identify the selected property key in every supported locale.
- **FR-008**: Saved panel state and view presets MUST accept valid property metric ids without changing default settings or built-in presets.
- **FR-009**: Invalid property metric ids MUST be normalized to the existing default channel value.
- **FR-010**: Property-only fact changes MUST refresh filtering and visual encoding without being classified as layout grouping changes.
- **FR-011**: Available property keys MUST update after initial fact construction and subsequent fact refreshes.
- **FR-012**: Existing queries, metrics, settings, presets, and graph appearance MUST retain their prior behavior when properties are unused.

### Key Entities

- **Normalized property map**: Optional per-note mapping from normalized property keys to one or more normalized scalar string values.
- **Property query term**: A normalized property key and exact normalized value, with the existing query-level negation flag.
- **Property metric id**: A saved categorical color channel selection that contains one normalized property key.
- **Available property keys**: Deterministic keys derived from current facts plus the active saved key.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Regression checks cover scalar, list, boolean, numeric, missing, unsupported, and dangerous-key frontmatter inputs.
- **SC-002**: Positive, negative, case-insensitive, list, quoted, and malformed property query scenarios pass automated checks.
- **SC-003**: Both control panel modes expose current property keys and preserve an absent saved key in automated UI checks.
- **SC-004**: A property-only metadata edit updates facts and encoding while reporting no grouping change in automated checks.
- **SC-005**: All 12 supported locale tables include the property metric label and pass locale parity checks.
- **SC-006**: The complete project verification and production build pass with default settings unchanged.

## Assumptions

- Frontmatter parsing continues to come from the Obsidian metadata cache.
- Exact equality is more predictable than substring matching for structured properties.
- For a list-valued property, filtering considers every usable item while coloring uses the first usable item.
- Property discovery is limited to notes already represented in the current graph facts.
- Property values are not persisted separately; saved state stores only the selected property metric id.
- No dependency, release metadata, README, or built-in preset version changes are required.
