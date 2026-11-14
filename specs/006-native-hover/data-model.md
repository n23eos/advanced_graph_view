# Data model

Per-session state: last valid target path and pointer coordinates, active preview path, HoverParent {hoverPopover}, disposed flag, captured target element/window/document. No persisted state.

Transitions: no target -> plain hover remembers target -> modified hover emits once -> new target closes previous and emits -> modifier release/blur/gesture/destroy closes and clears as appropriate. Destroy is idempotent and removes listeners from original window. New renderer gets a new controller.
