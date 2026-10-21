---
"@sapporta/grid": minor
"@sapporta/frontend": minor
---

The parent of a tree table's row can no longer be set to the row itself or
to one of its descendants from Sapporta's own screens. The grid's parent
cell editor and the record sheet's parent field offer every other row.

- `@sapporta/grid`: lookup columns take `lookupForRow(row)`, the choices the
  editor offers for one row; `rowLookupCapabilities(preset, row)` reads them.
- `@sapporta/frontend`: `buildRecordFormFields` takes the edited `rowId`,
  and `LookupStore.table(name, narrowing?)` takes a narrowing.
