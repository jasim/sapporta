---
"@sapporta/server": minor
"@sapporta/shared": minor
"@sapporta/frontend": minor
---

Replace HTTP-shaped `scopedRows()` read inputs with generic, Drizzle-shaped
queries.

`page`, `scan`, `count`, and `countBy` now accept direct Drizzle expressions.
Paged reads use numeric page semantics, while scans stream the complete visible
selection through one deterministic SQLite cursor and one read snapshot,
without repeated `LIMIT`/`OFFSET` queries or full-result materialization.
The raw `scanTableRows()` cursor primitive is also exported for workflows that
compose their own explicit row predicate.
`lookup` has distinct typed ID and search modes. Search lookup uses bounded
numeric limits, while ID lookup accepts only a bounded, non-empty ID list.
Generated table contracts coerce and bound pagination and lookup numbers before
handlers resolve table-dependent filters, columns, IDs, search, and ordering;
their generated client inputs remain in the string wire shape.
The named HTTP query resolvers are exported directly from `@sapporta/server`.
