# Hover contract

Registered source id remains graph-insight-view. Native event includes pointer-compatible event, registered source, per-view hoverParent, canvas targetEl and exact path linktext. No modifier means no native event. Existing onNodeHover/onExploreAim signatures remain unchanged. New optional onNodePreview carries nodeId|null and PointerEvent. Native popup owns rendering; custom graph tooltip remains independent.
