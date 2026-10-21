---
"@sapporta/server": minor
---

`treePathRelation(table, auth)` gives the paths of a tree table's rows to
reports and other code that runs raw SQL. It returns one member of a
`with recursive` list, `tree_paths(id, parent_path, path)`, with the same paths
as the `treePath()` computed field: it reads only rows the request may see, and
a path stops at the nearest ancestor the request cannot see. `name`,
`separator` and `column` options rename the relation, change the separator
(`" > "` by default) and name each row by one column instead of its label.
Rows in a loop of parents that never reaches a top-level row have no row.
