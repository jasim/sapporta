---
"@sapporta/shared": minor
---

`TableSchema.tree` describes a table whose rows form a tree. The list query
accepts `tree` (`ancestors` or `ancestors-and-descendants`) and
`fixed[col][op]` conditions, and the list response `meta` can carry
`tree: { matchCount, contextIds }`. `resolveTableTree` fills in the defaults
of a tree declaration. `encodeFilters`, `encodeTypedFilters`, `decodeFilters`,
and `wireKey` take an optional `FilterNamespace` (`"filter"` or `"fixed"`).
