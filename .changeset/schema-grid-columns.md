---
"@sapporta/frontend": minor
---

`SchemaTableGridView`, `useSchemaTableGrid`, `defineSchemaTGrid` and
`TablePage`'s `gridOptions` take `columns`: the root table's columns in that
view, as the spec list or builder callback a `defineTGrid` level takes. A page
can hide columns, change how some show, and add its own, such as an "Edit"
column with a button, without listing every schema column:

```tsx
columns={(c) => [
  c.remainingTable({
    exclude: ["created_at"],
    columnOptions: { note: { renderCell: NoteCell } },
  }),
  c.client("edit", { renderCell: EditButton, activation: editRow }),
]}
```

`NoteCell` and `EditButton` are your own cell components; `editRow` is a cell
activation, `{ startsOn, describe, run }`.

A new `columns` value rebuilds the grid, so keep it in a module constant or
`useMemo`. A builder callback runs when the grid builds, not when the grid is
declared.

`remainingTable` takes `columnOptions`, the options `table(...)` takes, for
some of the columns it adds; those columns keep their schema order. It now
also skips a column the list names with `table(...)` after it, so
`[c.remainingTable(), c.table("notes")]` moves `notes` to the end.
`TGridRemainingTableColumnSpec` takes `AppServices` as its second type
parameter, like the other column specs.

A level's columns are checked against its table when the grid builds, so a
wrong name is reported then rather than when the grid is declared. It throws,
naming the level and the table, for a column the table lacks, for
`columnOptions` on a column `remainingTable` does not add, for a client column
whose id is a table column's name, and for a column shown twice.

`expandTGridColumnSpecs` and its `TGridExpandedColumnSpec` result are exported
for an app that compiles a level's columns itself: it turns a `columns` value
into the visible columns, in order, with every name checked against the table.
