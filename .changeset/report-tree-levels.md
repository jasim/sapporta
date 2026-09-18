---
"@sapporta/frontend": minor
---

`ReportGridDataset` shows a `GridDataset` level that declares `tree` as one
tree under one header. It indents each row by its depth in the tree column
and shows a chevron on rows with children. Enter opens the cell's link, and
Space or the chevron expands or collapses the row. A sort orders the rows
among their siblings at every depth, and footer rows stay below the tree.
`defaultCollapsed: true` starts the tree collapsed. In the narrow cards
layout, the tree column is the card title. `ReportGridDataset` runs
`gridDatasetTreeProblems` when it receives a dataset, and also rejects a
tree level that declares child levels.
