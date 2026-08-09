# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — 2026-08-09

### Added

- **Local 3D graph pane** — a right-sidebar view showing the neighborhood of
  the active note: a depth slider (1–4 hops), the root note highlighted, rings
  fading with distance, and the camera framing the cloud on its own once the
  layout settles. Click a node to open the note. Opens from the command
  palette: *Open local 3D graph*.
- **Local graph export to Markdown** — a button in the pane (and a command)
  writes the neighborhood as a note beside the root: one section per depth
  ring, direction arrows on the first ring (→ outgoing, ← incoming, ↔ mutual),
  and each deeper note names the note it was reached through.

### Changed

- **Free layout is now on in every bundled preset.** Existing installs pick
  this up automatically when their bundled presets re-seed.
- **Auto-fit** — the camera frames the whole graph after the first layout
  settles and after switching a view preset. Panning or zooming by hand
  cancels the pending fit; your framing always wins.
- **Nodes stay visible at any zoom** — in 2D a node never renders smaller than
  2.5 px on screen, so zooming far out no longer turns the vault into dust or
  hides small notes entirely.
- **Layout spread adapts to vault size** — repulsion and link distance scale
  with the number of notes, so a large vault no longer flies apart and a tiny
  one no longer clumps into a dot. The physics sliders keep showing your own
  values; the adjustment happens on the way to the simulation.

## [0.5.0] — 2026-08-03

### Added

- **Side-pane mode** — a toolbar toggle (also a command, so it can take a
  hotkey). With it on, clicking a note opens it in a pane beside the graph
  instead of on top of it, and every following note replaces the one in that
  same pane rather than spawning another split. Close the pane and the next
  click makes a new one. Middle click and "Open in new tab" are unaffected.
- **Four diagnostic view presets.** *Orphans*, *Broken links* and *Dead ends*
  each turn on their overlay, drop the scheme to mono and switch labels on, so
  the matches are the only thing lit and can be read and acted on one by one.
  *Attention map* sizes nodes by PageRank and colors them by opens in the last
  90 days — big and cold is a hub you have stopped reading.
- **Settings profile.** Export your view presets, filters and preferences to a
  file and import them in another vault. Usage history and node positions stay
  behind; they describe one vault, not a way of working.
- **Reset settings to defaults**, separate from the existing reset of plugin
  data. Both now ask for confirmation before they run.
- **Empty-vault placeholder** instead of a blank canvas when there are no
  markdown notes to graph.

### Changed

- **Light themes are supported properly.** Scheme colors that ran to near-white
  are dimmed just enough to stay visible on a light background, keeping their
  hue; the glowing "galaxy" schemes, which bring their own dark backdrop, are
  left as they were. Switching theme now repaints the graph immediately instead
  of waiting for a restart.
- **`prefers-reduced-motion` is respected**: explore-mode camera flights and the
  session-trail replay cut straight to their end state.
- **The layout settles about twice as fast.** Repulsion is the entire cost of a
  simulation tick, and its price is set by how accurately it is approximated.
  That accuracy only matters once the graph is coming to rest — while nodes are
  still flying, nobody can see the difference — so it now starts cheap and
  tightens as the layout cools. On a 3000-note vault a 3D layout reaches rest in
  about 5 seconds instead of 9, and a 2D one in 1.8 instead of 2.9, with the
  same final shape.
- **The layout worker stays responsive on large vaults.** Ticks are now paced by
  what the previous one actually cost, with a guaranteed gap between them, so
  dragging a node or changing a setting is handled promptly instead of queueing
  behind physics.

### Fixed

- **Cluster colors no longer change between sessions.** Community detection is a
  randomised algorithm and was left unseeded, so recomputing the same vault
  could hand out different cluster ids and silently recolor the graph.

- A crashed layout or metrics worker no longer leaves the view silently frozen —
  it says what stopped, what still works, and offers a restart. A crashed
  metrics worker previously also blocked every later computation.
- A lost WebGL context is reported with a rebuild button instead of leaving a
  blank canvas behind.
- A `usage.json` with a valid-JSON but wrong shape is now repaired entry by
  entry rather than taken at face value; a file that is not a usage log at all
  is moved aside as `usage.json.corrupt` instead of being overwritten.

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
- **Follow active note** — a toolbar toggle that moves the camera to whichever
  note you open elsewhere in the vault and marks it as selected. It stands
  aside when explore mode is driving the camera, when the note is filtered out,
  and when the graph itself opened the note; in focus mode it rebuilds the
  neighborhood around the new note instead of panning.
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
