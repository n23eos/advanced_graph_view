# Research: Workspace state

- Decision: `View.getState(): Record<string, unknown>` and `setState(state: unknown, result: ViewStateResult): Promise<void>`. Rationale: Obsidian owns per-leaf workspace persistence. Rejected: plugin data.json shared state. Verified installed obsidian.d.ts and Context7 `/obsidianmd/obsidian-api`, official API views documentation.
- Decision: capture world center using logical screen size, scale and referenceScale. Rationale: pixel offsets break on a different window size.
- Decision: capture 3D position, pivot, yaw and pitch; panel settings retain mode/focal. Rationale: hidden mode restoration would disagree with UI.
- Decision: restore after apply3D, cancel autoFit. Source inspection: set3DMode may reset camera; first worker position update does not.
- Decision: trailing save debounce using captured host Window. Rationale: avoid workspace writes per render/physics frame and clear the correct window timer.
- Decision: malformed independent fields are ignored; no migration of data.json or snapshot formats.

Official reference: https://docs.obsidian.md/Reference/TypeScript+API/View
