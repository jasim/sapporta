---
"@sapporta/frontend": patch
---

A generated grid no longer offers a cell of an `apiWritable: false` column for
editing. The table API rejects that column, so the edit used to fail on save.
The record form and a record's detail fields already kept it read-only.
