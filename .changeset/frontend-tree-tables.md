---
"@sapporta/frontend": minor
---

The stock table page shows a table with `meta.tree` as one indented tree. It
loads all rows at once and hides the pager, shows each search or filter match
under its ancestors with "N matches" in the header, notes when the table has
more rows than one load returns, and offers "Add child row" in the row's
context menu. A `defineTGrid` level can override `tree` or set `tree: false`.
`TGridLevelInfo.pagination` says whether a level reads its rows by page or all
at once. Query state and `useTableLevelPager` follow it, so a custom page built
from the table hooks also shows a tree on one page.
TGrid sends a level's parent-row constraint and fixed filters as the list
read's `fixed` conditions, so a tree search never brings back rows outside
them. `fetchTableRows` takes `fixed`.
