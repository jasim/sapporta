---
"@sapporta/frontend": minor
---

Rows are drawn with their table's `rowCaption`, and apps can change how rows
are drawn with display slots.

- A table whose metadata names a `rowCaption` shows it under the row's label
  in pickers and editor options, such as an account's parent path under its
  name. Grid cells keep one line.
- `RowDisplayProvider` takes display slots per table:
  `{ accounts: { label: { needs: ["parentPath"], render: AccountName } } }`.
  A `label` slot draws a row's own label cell and every reference to it, at
  every grid level. `needs` lists the computed fields it reads; Sapporta asks
  for them with the page and with lookups, and draws `render` once they are
  known. `render` receives `context.surface` and `defaultContent`, so it can
  keep the default on some surfaces. Providers nest and merge by table, then
  by slot; `useTGridSession` reads the nearest provider.
- The session's `lookups` is now a row data store: besides labels, it holds the
  computed values of the rows it has seen, with `computedFor`,
  `ensureComputed` (batched per tick), `invalidateComputed()` and
  `reloadLabels(table)`. A write through a table session reads every computed
  value again, and the written table's labels; an answer to a read sent
  before the write is drawn but read again. Call both after writes made
  through your own endpoints. `createTGridSession(definition, { rowDisplays })` and
  `createLookupStore({ rowDisplays })` take displays outside React.
- The FK cell editor's placeholder names the current value.
