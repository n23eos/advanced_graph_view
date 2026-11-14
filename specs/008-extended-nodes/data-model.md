# Data model

GraphScope: attachments/unresolved booleans, default false/false.
GraphModel.scope optional; absent is legacy. GraphNode.kind optional note/attachment/unresolved; virtual nodes additionally carry sourcePath/linkpath in unresolved metadata. Node path is stable identity, numeric id dense and unique. Virtual identity is never passed to filesystem APIs.
Snapshots retain version 1, optional scope, paths/edges/metric arrays. Old rows without scope remain unchanged. Invalid explicit scopes cannot be reclassified as legacy.
