---
"@sapporta/grid": minor
---

Lookup columns (`foreignKey`, `lookupValue`) take `renderEntry`, which draws
each entry in the column's cells and in its editor's options, with what the
column would draw as `defaultContent`. The cell editor's placeholder now names
the current value. `CachedValueLookup.reloadEntries()` reads every cached
entry again, and every entry whose first load is in flight, and
`CachedSearchLookup.markSearchesStale()` makes the next load of each search
read it again; both keep the old results readable until then, and an answer to
a request sent before them never replaces a newer one.
