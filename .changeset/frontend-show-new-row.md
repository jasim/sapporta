---
"@sapporta/frontend": minor
---

A table opens on the row you just created. After New record saves, the table
puts the cursor on the new row, opens the tree branches above it and scrolls it
into view. If a search or filter leaves the row out, that search or filter is
cleared. Before, the table reloaded on its default view, and a new row under a
collapsed parent stayed hidden. A paged table shows the row only when it is on
the page the table opens on; on another page, the table opens as before.

To do the same from your own pages, use `session.showRow(rowKey, {
clearQueryIfHidden })`. It reads the rows again when the table doesn't have the
row yet, and it waits for a read that is already under way instead of starting
another. It resolves to `"shown"`, or to `"not-found"` when the row is still not
on screen, such as a row on another page of a paged table; a search or filter
it cleared is then put back. To open a table page on a row, navigate to it with
`showTableRowState(table, rowKey)` as the location state, or with
`showCreatedRowState(table, created)` for a row the table API just created.
