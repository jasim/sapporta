---
"@sapporta/grid": minor
---

A level can declare `tree` to show rows that refer to each other, such as
accounts with a `parent_id`, as one tree under one header. The tree column,
wrapped with `withTreeColumn`, indents each row by its depth and shows a
chevron on rows with children. `level.tree` expands, collapses, reveals, and
adds child drafts, and `treeExpansionChanged` reports expansion changes.
`tree.parentKeyValue` sets the typed key a child draft stores, and
`validateLevelTree` checks a tree declaration before a runtime exists. The
in-memory source keeps each filter match's ancestors, and a custom source can
mark such rows with `LevelSnapshot.treeContextRowKeys`.
