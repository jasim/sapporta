---
"@sapporta/grid": minor
---

A grid level can find one of its loaded rows: `level.focusRow(rowKey)` puts the
cursor on the row and scrolls it into view. On a tree level it first opens the
branches above the row, so a row under a collapsed parent is found too. In a
cell grid, `{ colId }` picks the cell the cursor lands on. It returns false when
the level's loaded rows don't include the row. Unlike a click, it does not
activate the row.
