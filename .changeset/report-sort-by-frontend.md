---
"@sapporta/frontend": minor
---

`ReportGridDataset` sorts a column by its `sortBy` columns, so rows that tie on
the clicked column, such as ledger postings on one date, follow a declared
order in both directions. A level's `sort` sets the order its rows start in.
A `sortBy` entry the level lacks fails when the dataset is drawn; a level
`sort` on a column the level does not show fails when that level's rows are
drawn.
