---
"@sapporta/grid": minor
"@sapporta/frontend": minor
---

Let table pages control what happens when keyboard navigation reaches the edge
of the loaded rows. The standard `TableGridView` now pauses on the visible
Previous or Next pagination button before changing pages. Lower-level hooks
and TGrid sessions remain policy-free unless the application provides a
boundary handler. Activating the focused pagination button changes pages and
returns focus to the first or last row of the newly loaded page. An arrow key
on that pagination button returns browser focus to the grid without changing
its cursor or selection.
