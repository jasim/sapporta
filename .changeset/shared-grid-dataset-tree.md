---
"@sapporta/shared": minor
---

A `GridDataset` level can declare `tree: { parentColumn, column? }` to show
rows that name a parent row of the same level, such as accounts with a
`parent_id`, as one tree. The level's nodes are one flat list, and
`parentColumn` names the column that holds the parent row's `rowKey`.
`gridDatasetTreeProblems` reports a tree level that names a parent column the
level does not have, or names a tree column that is not visible.
`gridDatasetTreeColumn` returns the column that shows a level's tree.
