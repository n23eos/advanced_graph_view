# Research: Frontmatter properties

## Decision 1: Normalize frontmatter into optional node facts

**Decision**: Add an optional property map to node facts. Normalize keys by trimming and lowercasing. Normalize strings, finite numbers, and booleans to strings. For arrays, keep supported scalar items in source order. Ignore null, empty strings, objects, nested arrays, and the host `position` entry.

**Rationale**: Optional storage preserves compatibility with test and runtime callers that construct node facts. String values give filtering and categorical encoding one stable representation. Source order gives list coloring a deterministic first category.

**Alternatives considered**: Read frontmatter directly in query and encoding paths was rejected because it duplicates host access. Preserving arbitrary JSON was rejected because equality and prototype safety become ambiguous. Storing only the first value was rejected because list filters must match any item.

## Decision 2: Use exact case-insensitive property filters

**Decision**: Add a `prop:key=value` query term. Normalize key and value casing. Match any normalized value exactly. Keep the existing query-level leading-minus negation behavior. Validate missing keys or values as bad values.

**Rationale**: Exact matching matches structured metadata expectations and avoids surprising partial matches. It composes with the existing AND and negation model.

**Alternatives considered**: Substring matching was rejected because values such as `todo` and `todo-later` would not be distinguishable. A separate list grammar was rejected because any-item equality covers scalar and list properties consistently.

## Decision 3: Encode the property key in a dynamic metric id

**Decision**: Represent a property color metric as `prop:<normalized-key>`. Treat valid property metric ids as categorical. Use the first normalized value for color and an empty category for notes without a value.

**Rationale**: Existing channel state and view presets already persist metric ids. A dynamic id adds no settings field or migration and lets existing encoding, legend, and tooltip paths operate normally.

**Alternatives considered**: A separate `colorPropertyKey` setting was rejected because it introduces state synchronization and migration. Adding property ids to the static list was rejected because keys are vault-specific.

## Decision 4: Discover keys from current facts

**Decision**: Collect property keys across current facts, rank by descending note frequency and then key name, and always append the active saved key if absent. Update both panel modes after initial facts and refreshes.

**Rationale**: Frequent keys are easier to find, deterministic ordering avoids UI churn, and retaining the active key prevents a saved preset from appearing invalid in a filtered graph.

**Alternatives considered**: Alphabetic-only ordering was rejected because a long vault can bury common properties. Scanning the entire vault separately was rejected because controls should describe the current graph. Dropping absent saved keys was rejected because it would hide persisted state.

## Decision 5: Deep-compare normalized maps without regrouping

**Decision**: Compare property keys and value arrays by content. Property differences set `changed` but not `groupingChanged`.

**Rationale**: Every metadata cache read builds fresh objects. Reference comparison would report false changes, while regrouping the force layout is unnecessary for a color or filter fact.

**Alternatives considered**: JSON serialization was rejected because it allocates and depends on insertion order. Treating properties as grouping changes was rejected because current layout rules do not consume them.

## Decision 6: Accept valid dynamic ids during normalization

**Decision**: Settings and view preset normalization accept static metric ids plus valid `prop:<key>` ids. Invalid dynamic ids fall back to the existing default channel assignment. Built-in defaults and preset versions stay unchanged.

**Rationale**: Persisted property choices must survive restart, while malformed hand-edited values must not leak into encoding. No schema version is needed because the containing field already stores metric ids as strings.

## Decision 7: Localize one parameterized metric label

**Decision**: Add `metric.property` to all 12 locale tables and render it with the selected key.

**Rationale**: One parameterized label scales to arbitrary vault keys and keeps locale parity. Property keys remain user data and are not translated.

## Risks and mitigations

- **Prototype-related keys**: Build maps without inherited keys and iterate own entries only.
- **Large frontmatter objects**: Normalize each current note once per fact rebuild and keep linear scans.
- **List ambiguity**: Filtering uses any value; coloring documents and tests the first value rule.
- **Stale panel options**: Refresh options after both initial build and metadata refresh, retaining the active key.
- **Integration ordering with other features**: Keep changes within current extension points and avoid release or 004 plan edits.
