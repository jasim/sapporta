---
"@sapporta/grid": minor
---

A sort that names a column the level lacks, or a column with neither `compare`
nor `sortKeys` entries, now throws instead of being ignored. An in-memory
source throws from construction for such an `initialSort`, and
`query.sort.set` rejects and keeps the current sort. `inMemoryLevelSource`
takes a `label` that names the level in the message; `inMemoryGridDataSource`
names the level itself.
