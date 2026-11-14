# Advanced Graph View: existing listing maintenance

Prepared 2026-11-14. This is a documentation and review pack, not a new submission.

## Identity and current status

- Name: Advanced Graph View.
- Existing plugin ID: `graph-insight`. It stays unchanged to preserve installations and stored data.
- Repository: https://github.com/n23eos/advanced_graph_view .
- Existing listing: https://community.obsidian.md/plugins/graph-insight . On 2026-11-14 it shows Advanced Graph View, n23eos and about 9k downloads. The owner independently confirmed this.
- Published directory version observed during preparation: 0.10.1. New local candidates are not published releases.
- No new entry, submission PR, directory edit, external message, tag or release is authorized by this pack.

## Completed repository audit

- README now offers stable installation through Community Plugins, retains BRAT/manual options, removes the obsolete self-link named Graph Insight and keeps the public name unchanged.
- Donation links were removed from README to comply with the current plugin requirement; existing Ko-fi support remains in manifest fundingUrl.
- README corrects stale default metrics and unconditional FPS claims against builtinPresets.ts and the recorded hardening benchmark. It documents property queries, per-tab state, previews, optional attachment/missing-target nodes and local snapshot storage.
- Manifest ID/name, author, description, fundingUrl and desktop flag remain intact. Description is 119 characters and ends with a period. minAppVersion remains 1.13.0.
- LICENSE contains the MIT license. Source contains no sample plugin placeholders or command IDs repeating the plugin ID.
- Existing release workflow checks version alignment, builds the three assets and attaches provenance. Its pushed-tag trigger publishes automatically, so no tag must be created or pushed for this task.
- Runtime network behavior and local data disclosures are unchanged. Community links in README are documentation links, not plugin network requests.

## Ready English text for the existing listing

Short description:

Explore large vaults as an interactive 3D graph with clusters, PageRank, color schemes and metric-driven node encoding.

Long description:

Visualize large Obsidian vaults with a desktop-only WebGL graph. Map note size, color and glow to numeric metrics, and color nodes by folders, tags, clusters or frontmatter properties. Search and filter the graph, focus on neighborhoods, explore links in 3D, inspect broken links, replay timelines, compare graph snapshots, and export PNG, JSON, GEXF or topic maps. Optionally include all attachments and missing link targets, with both additions disabled by default. Each graph tab preserves its camera and committed query. Usage history stays in the vault, and the plugin makes no network requests.

Fields: name Advanced Graph View; existing ID graph-insight; repository n23eos/advanced_graph_view; desktop only; MIT; Free. Keep the existing owner account. Suggested categories are Visualization and Research; the observed AI category is inconsistent with the current feature set and is only a proposed future listing edit.

## Deferred owner actions

These are future actions, not approval requests for the current coding/install task.

- Complete remaining native restart, popup and popout acceptance described in specs/004-hardening/verification.md and feature verification documents.
- Review the final bundled third-party notices before the next release.
- When separately authorizing publication, verify stable x.y.z alignment across manifest, package, versions and tag; run the exact release commit through CI/build.
- Use the existing entry's Edit listing or Review branch flow if a listing update is desired. Never create a duplicate entry or an obsidian-releases submission PR.
- Only after release authorization, create the matching release/tag/assets and use Check for new releases if the published release is missing from the existing entry. Request review is reserved for a review rescan after fixes.

## Official sources checked 2026-11-14

- Existing entry: https://community.obsidian.md/plugins/graph-insight
- Requirements: https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
- Manifest: https://docs.obsidian.md/Reference/Manifest
- Existing entry management: https://docs.obsidian.md/community-directory/manage-entry
- Submission and release process: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
