---
"@sapporta/frontend": minor
---

A table opens on the row you just created, on the page you left. New record
now returns to the table with the page, sort, search and filters it had, where
before it returned to the table's first page and default view. The cursor is
on the new row and it is scrolled into view; on a tree, the branches above it
open. On a flat table whose page doesn't hold the new row, the row is shown at
the top of that page, and the rows already there keep their places. The row
stays there until the rows are read again, such as on reload or a change of
page, sort, search or filter, which places it by sort like any other row.

To do the same from your own pages, use `session.showRow(rowKey, { savedRow })`,
passing the row as the table API returned it. Without `savedRow`, or on a tree,
it reads the rows again when the table doesn't have the row yet, and with
`clearQueryIfHidden` it clears a search or filter that leaves the row out,
putting it back when clearing doesn't bring the row. It resolves to `"shown"`,
or to `"not-found"` when the row is still not on screen. To open a table page
on a row, navigate to it with `showTableRowState(table, rowKey, savedRow)` as
the location state, or with `showCreatedRowState(table, created)` for a row the
table API just created. `navigateToNewRecord(table, tableSearch)` takes the
table page's query string so the form returns to the same view.
