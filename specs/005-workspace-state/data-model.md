# Data model

GraphViewState version 1 contains optional camera and hardQuery. Each leaf owns pending and last valid state. No global cache.

Camera contains viewport {centerX, centerY, scale, referenceScale} and camera3d {position, pivot, yaw, pitch}. Coordinates must be finite; scales positive and within viewport bounds; pitch within renderer bounds. Camera groups normalize atomically. Query must be a valid supported query string; an empty string explicitly clears the filter.

Transitions: unknown input -> normalization -> pending until model/3D ready -> applied. Late valid state applies immediately. Internal reopen captures the last valid state; newer external state wins. Close cancels persistence timers and keeps the last camera available to getState.
