---
"@sapporta/grid": minor
---

`LevelOptions.defaultCollapsed` is removed. The grid never read it, so a
level that set it still started with its rows as the host expanded them. A
host collapses a level's rows by not expanding them, and a tree level's rows
start collapsed with `tree.defaultExpanded: false`.
