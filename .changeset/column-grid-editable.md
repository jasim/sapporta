---
"@sapporta/server": minor
"@sapporta/shared": minor
"@sapporta/frontend": minor
---

A column's meta takes `gridEditable: false` for a column the generated grids
and a record's detail fields show but never edit, such as text an import
wrote. Unlike `apiWritable: false`, the table API still accepts it, so code
and agents can set it, and a create form still asks for it. The extracted
`ColumnSchema` carries it.
