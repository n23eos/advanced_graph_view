# Advanced Graph View 0.12.0-beta.2

- Dragging a node carries linked neighbours up to three hops away, with gradual trailing motion.
- Neighbours continue drifting briefly after a drop, then settle around the dropped node.
- Drag motion updates independently of slower full-graph physics ticks.
- Hovered nodes resize smoothly and their links fade into the accent color. Link highlighting is skipped above 600 links and when links are hidden.
- Bottom-right controls avoid overlap with the floating Obsidian status bar.

This beta includes the previous hardening and optional graph features. Native visual acceptance and large-vault performance validation remain incomplete. Back up your vault before testing.

Requires Obsidian 1.13.0 or later; desktop only.
