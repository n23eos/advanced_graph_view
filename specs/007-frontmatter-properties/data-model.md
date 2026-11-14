# Data model: Frontmatter properties

## Normalized property map

An optional per-node mapping:

```text
normalized key -> ordered normalized values
```

### Invariants

- Keys are trimmed and lowercased.
- The empty key and `position` are absent.
- Values are non-empty strings.
- String values are trimmed but retain display casing; comparisons normalize casing at use time.
- Finite numbers and booleans are represented by their string form.
- Arrays contain only supported scalar values in source order.
- Empty value arrays are absent.
- The map has no inherited data semantics.
- The entire field is optional so existing node-fact producers remain compatible.

## Property query term

Fields:

- `key`: normalized non-empty property key.
- `value`: normalized non-empty comparison value.
- `negated`: existing wrapper flag applied to the completed match result.

### Match rule

A positive term matches when the note contains the key and at least one normalized property value equals the term value without case sensitivity. Missing keys and empty value lists do not match.

## Property metric id

Shape:

```text
prop:<normalized-key>
```

### Invariants

- Prefix is exactly `prop:`.
- Key is non-empty and already normalized.
- A valid property metric is categorical.
- The category for a node is its first normalized value or the empty string.

## Available property key

Fields derived at runtime:

- `key`: normalized key.
- `frequency`: number of current node facts containing at least one value.
- `active`: whether it is the key stored in the selected color channel.

### Ordering

1. Descending frequency.
2. Ascending key for equal frequency.
3. If the active key has frequency zero, retain it after discovered keys.

## State transitions

### Initial graph build

1. Metadata cache frontmatter is normalized into node facts.
2. Available keys are collected.
3. Panel options are updated.
4. Existing channel state determines whether property encoding is applied.

### Metadata refresh

1. Fresh normalized maps are built.
2. Deep comparison determines whether facts changed.
3. Property-only changes refresh filtering, encoding, and available keys.
4. Property-only changes do not invalidate the active layout rule.

### Settings and preset load

1. Static metric ids retain current behavior.
2. Valid dynamic property metric ids are retained.
3. Invalid metric ids fall back to the existing default channel assignment.
