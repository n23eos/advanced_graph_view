# Workspace state contract

- Serialization version: 1. Unknown versions and non-object values are ignored.
- Optional camera and hardQuery normalize independently; no exception escapes invalid input.
- getState returns a detached serializable snapshot for this leaf.
- setState may arrive before onOpen or after renderer readiness.
- State does not force a hidden panel mode change.
- Camera changes and committed query changes request workspace persistence after a short debounce. Restore and physics do not.
- Existing workspaces without this state retain current defaults.
