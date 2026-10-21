---
"@sapporta/server": minor
---

`attachReferenceComputed(dataset, { db, auth, tables, names })` computes, once
per report, the computed fields that the rows named by the dataset's
`reference` columns are drawn with (each table's computed `rowCaption`, plus
`names`), and returns the dataset with `computed` set. Call it on datasets
whose ids come from the report's own scoped reads.
