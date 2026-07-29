# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-07-29

### Added

- **Explore mode** — travel the graph one link at a time. The camera sits on a
  note, you point the mouse down one of its links, it lights up and names the
  note it leads to, and a click flies you there. Backspace retraces, Space lets
  go so you can pick the next note anywhere in the vault, Esc leaves. Aiming is
  by direction rather than by pixel, so a hub with fifty links stays navigable.
- **Localisation into 12 languages** — the whole UI follows the Obsidian app
  language: English, German, Spanish, French, Italian, Japanese, Korean,
  Polish, Portuguese (Brazil), Russian, Ukrainian, Chinese.
- **Pins survive a restart.** Pinned notes are marked with a ring, kept through
  graph rebuilds, and stored in `positions.json`. A lasso selection can be
  pinned or released in one go.
- Every panel toggle now has a command: dead ends, broken links, timeline,
  cluster bubbles, physics, 3D, and an explicit exit from focus mode. No
  default hotkeys — assign your own in Obsidian's settings.
- Context menu: **Open to the right** and **Reveal in file explorer**.

### Fixed

- The search bar's suggestion box no longer leaves a pending timer behind when
  the graph view is closed.

### Changed

- English UI strings moved to sentence case, matching the Obsidian style guide.
- `positions.json` gained an envelope around the coordinate map so it can carry
  pins. Files written by earlier versions are read as before; a file written by
  0.4.0 and read by an older version loses its saved positions.

## [0.3.0] — 2026-07-27

### Added

- Physics-off toggle, so a settled layout can be frozen in place.
- Clustering rules for the layout: group by links, tags, or folders.
- CI workflow, desktop-only manifest, install docs, npm metadata.

### Fixed

- Node dragging tracks the pointer 1:1 without stutter, and a dragged note tows
  its linked neighbours instead of contracting the whole graph.
- Hovering a node no longer dims the entire scene; 3D orbit rotates around the
  scene centre.

## [0.2.1] — 2026-07-21

### Fixed

- Addressed the Obsidian plugin review warnings.

## [0.2.0] — 2026-07-21

### Removed

- **Breaking:** semantic edges, along with the `transformers` and `onnxruntime`
  dependencies. The plugin bundle is now a fraction of its former size and the
  graph is built purely from real vault links.

### Added

- Demo video and GIF in the README.

## [0.1.6] — 2026-07-21

### Changed

- Display name is now "Advanced Graph View".

## [0.1.5] — 2026-07-20

### Fixed

- Labels vanishing in 3D above zoom 1.0; added a master label toggle.

## [0.1.4] — 2026-07-20

### Added

- Colour schemes with glow rendering, view reset, thinner links.

## [0.1.3] — 2026-07-20

### Changed

- English UI throughout, declarative settings API.

## [0.1.2] — 2026-07-20

### Fixed

- Addressed the Obsidian plugin review findings.

## [0.1.1] — 2026-07-20

### Added

- View presets, overlay highlighting, tag and folder filters, cursor tools.

## [0.1.0] — 2026-07-20

Initial release: an interactive 3D graph view for large vaults, with clusters,
PageRank, metric-driven node encoding and usage tracking.

[Unreleased]: https://github.com/n23eos/advanced_graph_view/compare/0.4.0...HEAD
[0.4.0]: https://github.com/n23eos/advanced_graph_view/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/n23eos/advanced_graph_view/compare/0.2.1...0.3.0
[0.2.1]: https://github.com/n23eos/advanced_graph_view/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/n23eos/advanced_graph_view/compare/0.1.6...0.2.0
[0.1.6]: https://github.com/n23eos/advanced_graph_view/compare/0.1.5...0.1.6
[0.1.5]: https://github.com/n23eos/advanced_graph_view/compare/0.1.4...0.1.5
[0.1.4]: https://github.com/n23eos/advanced_graph_view/compare/0.1.3...0.1.4
[0.1.3]: https://github.com/n23eos/advanced_graph_view/compare/0.1.2...0.1.3
[0.1.2]: https://github.com/n23eos/advanced_graph_view/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/n23eos/advanced_graph_view/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/n23eos/advanced_graph_view/releases/tag/0.1.0
