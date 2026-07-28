---
"@sapporta/server": minor
"@sapporta/shared": minor
---

Replace HTTP-shaped `scopedRows()` read inputs with generic, Drizzle-shaped
queries.

`page`, `scan`, `count`, and `countBy` now accept direct Drizzle expressions.
Paged reads use numeric page semantics, while bounded scans support exports
without materializing every matching row. `lookup` accepts typed IDs, columns,
and numeric limits. Generated table handlers strictly resolve URL filters,
search, sorting, pagination, and lookup strings before calling the row-scoped
data API.
