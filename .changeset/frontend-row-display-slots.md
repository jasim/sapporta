---
"@sapporta/frontend": minor
---

Display slots now reach column cells, pickers and the record sheet.

- A `columns` slot draws one cell of a table's own rows:
  `{ stocks: { columns: { buy: { needs: ["buyVolume"], render: BuyCell } } } }`.
  Each level asks only for the needs of the columns it shows, so a hidden column
  costs nothing. On a foreign-key column, `referenceNeeds` names computed fields
  of the referenced row, which the slot receives as `reference`. A field drawn
  by a slot stays in narrow cards when its own value is empty.
- `LookupPicker` given a table's lookup (`useTableLookup`, form fields) draws
  its options with the table's label slot, and shows the chosen row's caption
  beside the input, inside the field, without changing its height. It hides
  while you type. `itemDisplay` still takes precedence.
- The record sheet draws references with the label slot, and fields with their
  column slot.
- `useRowComputed(table, id, fields)` reads computed values in your own
  components, batched per render; table grids provide their store, and
  `RowDataStoreProvider` provides one elsewhere.
- `tableDisplay(schemas, display)` types a table's slots by the value schemas
  of its computed fields.
- On a tree level, the parent column's picker shows each option's parent path.
