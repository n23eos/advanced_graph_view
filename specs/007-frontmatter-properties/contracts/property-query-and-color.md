# Contract: Property query and color channel

## Query syntax

```text
prop:<key>=<value>
-prop:<key>=<value>
prop:"<key>=<value with spaces>"
```

### Parsing contract

- `prop` is a known operator.
- Split its argument at the first equals sign.
- Key and value must both be non-empty after trimming.
- Normalize the key by trimming and lowercasing.
- Compare values after trimming and lowercasing.
- A quoted operator argument may contain spaces.
- Additional equals signs belong to the value.
- Invalid known-property terms produce the existing `badValue` diagnostic with operator `prop`.

### Matching contract

- Scalar and list properties use the same any-value exact equality rule.
- A missing property does not match.
- Negation uses the existing parsed-term wrapper.
- Other query operators and unknown operator fallback remain unchanged.

## Color metric contract

```text
prop:<normalized-key>
```

- A valid property metric is accepted only in the color channel.
- It is treated as categorical by metric computation and encoding.
- The first normalized property value is the category.
- Missing or empty values produce an empty category and the default node tint.
- The metric label uses `metric.property` and supplies the key as `{key}`.
- Simple and expert color selectors expose the same dynamic property choices.
- The active saved property metric remains an option even if no current note exposes its key.

## Persistence contract

- The selected metric id is stored in the existing panel channel field.
- View presets reuse their existing panel payload.
- No new top-level settings field or preset version is introduced.
- Valid property ids survive settings and view preset normalization.
- Invalid property ids fall back to the existing default color channel value.

## Refresh contract

- Equivalent normalized property maps compare equal even when rebuilt as new objects.
- A property value or key change sets facts `changed` to true.
- A property-only change leaves `groupingChanged` false.
- Property options refresh after initial construction and later metadata refresh.
