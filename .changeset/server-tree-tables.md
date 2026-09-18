---
"@sapporta/server": minor
---

`meta.tree: { parentColumn }` declares that a table's rows form a tree through
a nullable foreign key to its own primary key. The declaration is checked at
boot and published in `TableSchema.tree`. A list read with a filter or search
and `tree=ancestors-and-descendants` (or `ancestors`) returns each match with
its ancestors and subtree, inside the caller's row scope, and reports
`meta.tree`. List reads also accept `fixed[col][op]=value` conditions, which
every returned row satisfies, including the ancestors and descendants of a
tree read. `sapporta rows list` takes `--tree` and `--fixed`.

`scopedRows().treeMatch({ fixed, match, matchContext })` selects the matches
of a tree table with their ancestors (and descendants) and returns a `where`
for `page`, `findMany`, `scan`, or `count`, with the match count and the ids
of the context rows. `resolvePageQuery` now returns `{ kind: "rows", input }`
or, for a tree read with a filter or search, `{ kind: "treeMatch", treeMatch,
page }`.
