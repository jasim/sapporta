---
"@sapporta/grid": minor
"@sapporta/frontend": minor
---

Text cells no longer show a tooltip of their own. Every non-empty text column
opened a popup on hover, whether or not the value was long enough to be
clipped, which made the tooltip noise on short columns and left no way to turn
it off. Whether a value is worth pointing at depends on the data in the row,
which the application knows and the column kind does not.

Columns that want a tooltip now ask for one, and to make that cheap,
`renderCell` overrides now receive `defaultContent`: the cell the column would
have rendered on its own, formatting and truncation included. Wrapping it
decorates the built-in cell instead of rebuilding it, and ignoring it replaces
the cell outright, as before. This holds at every layer — column-preset
options, TGrid column options, and the new `renderCell` prop on
`ReportGridDataset` (keyed by level name and then by column id), where the
report's drill-through links stay attached around the override's output.

```tsx
columns.table("title", {
  renderCell: ({ defaultContent, row }) => (
    <CellTooltip content={row.summary}>{defaultContent}</CellTooltip>
  ),
});
```

`CellTooltip` from `@sapporta/grid/column-preset` carries the popup's sizing
and placement. An empty `content` renders the cell body alone, so a tooltip
can be shown on the rows that need one and left off elsewhere. A cell built
from scratch instead of from `defaultContent` can apply
`presetCellClassNames` to keep the built-in truncation and stay lined up with
the columns beside it.
