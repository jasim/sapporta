---
"@sapporta/shared": minor
---

A report column can name the columns a sort on it orders by:
`sortBy: ["date", "sequence"]`, first key first. Each listed column, hidden
ones included, compares by its own `kind`, and all follow the direction chosen
on the column. A level can declare the order its rows start in with
`sort: [{ column, direction }]`. `gridDatasetSortProblems(dataset)` reports
`sortBy` entries the level lacks.
