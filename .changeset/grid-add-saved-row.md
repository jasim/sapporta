---
"@sapporta/grid": minor
---

A grid level can show a row that was saved somewhere else, such as by a form:
`level.addSavedRow(node, atIndex)` adds it to the level's loaded rows without
saving it again and without reading the rows again, so the rows around it keep
their places. The next read, such as a reload or a change of page, sort or
filter, puts the row where that read places it. A data source supports this
through the optional `write.addSavedNode`, which `restLevelSource` provides.
`addSavedRow` returns false for a source without it, such as
`inMemoryLevelSource`, whose rows are all loaded and sorted on the client, and
for a readonly source.
