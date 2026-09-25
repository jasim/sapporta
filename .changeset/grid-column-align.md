---
"@sapporta/grid": minor
"@sapporta/frontend": patch
---

`ColumnSchema` takes an optional `align` (`"left" | "right" | "center"`),
and `ColumnAlign` is exported from the grid core. The cell and the column
header align their content by it, so a value that a custom renderer wraps,
such as a report drill-down link, keeps its column's alignment. Preset
columns set it from their kind: numbers right, booleans center. A linked
number in a report grid now sits on the right like the other numbers.
