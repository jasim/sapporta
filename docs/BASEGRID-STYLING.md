# Styling BaseGrid Selection States

BaseGrid renders grid mechanics and stable DOM state. It does not own product
visuals. Style rows, cells, nested levels, and editing state with
`data-grid-part`, `data-row-*`, and `data-cell-*` selectors.

The Sapporta column preset supplies the default admin chrome for `TGrid` and
for grids that opt into `columnPreset.chrome()`. That preset may use CSS
variables internally, but application overrides should target the DOM state
attributes directly.

## Choose the States Your Grid Uses

Styling follows the interaction config. If the grid does not enable active
rows, row selection, or cell range selection, BaseGrid will not render those
states.

```ts
createGridRuntime({
  schema,
  dataSource,
  interaction: CELL_GRID_WITH_ACTIVE_ROW,
});
```

Common choices:

| Goal                                        | Interaction shape                         |
| ------------------------------------------- | ----------------------------------------- |
| Spreadsheet focus and editing               | Active cell                               |
| Spreadsheet range selection                 | Active cell + cell selection              |
| Highlight the row under the active cell     | Active cell + active row                  |
| Bulk actions on checked rows                | Active cell or row cursor + row selection |
| Master-detail panel that follows navigation | Active row + selected rows that follow it |

See [BASEGRID-INTERACTIONS.md](./BASEGRID-INTERACTIONS.md) for the interaction
presets and keyboard behavior.

## Put a Class on the Grid

For `TGrid`, pass a class name directly. It is applied to the root grid level,
so descendant selectors can style both the root rows and nested rows.

```tsx
<TGrid session={session} className="projectGrid" />
```

For a direct BaseGrid composition, put the class on a wrapper or supply it
through your grid chrome.

```tsx
<div className="projectGrid">
  <GridRuntimeProvider runtime={runtime}>
    <GridLevel path={rootPath("projects")} />
  </GridRuntimeProvider>
</div>
```

## Highlight the Current Row

BaseGrid marks the current row with `data-row-active="true"`.

```css
.projectGrid [data-grid-part="row"][data-row-active="true"] {
  background: #eef4ff;
}

.projectGrid [data-grid-part="row"][data-row-active="true"]::before {
  background: #2563eb;
  content: "";
  inset-block: 0;
  inset-inline-start: 0;
  pointer-events: none;
  position: absolute;
  width: 2px;
}
```

## Style Selected Rows

BaseGrid marks selected rows with `data-row-selected="true"`.

```css
.projectGrid [data-grid-part="row"][data-row-selected="true"] {
  background: #eef4ff;
}

.projectGrid
  [data-grid-part="row"][data-row-active="true"][data-row-selected="true"] {
  background: #dbeafe;
}
```

Use `aria-selected="true"` for accessibility-aware selectors when that is more
appropriate, but prefer `data-row-selected` for visual chrome.

## Style the Active Cell

BaseGrid marks the active cell with `data-cell-status="focus"`.

```css
.projectGrid [data-grid-part="cell"][data-cell-status="focus"] {
  background: white;
  box-shadow: inset 0 0 0 2px #2563eb;
  z-index: 3;
}
```

## Style Cell Range Selection

Cells in the selected range are marked with
`data-cell-status="in-selection"`.

```css
.projectGrid [data-grid-part="cell"][data-cell-status="in-selection"] {
  background: #eaf1ff;
}
```

When focus moves to another nested level, the inactive level root has
`data-active="false"`. Use that root state when inactive cell chrome should
look different.

```css
.projectGrid
  [data-grid-part="root"][data-active="false"]
  [data-grid-part="cell"][data-cell-status="focus"] {
  background: #f3f4f6;
  box-shadow: inset 0 0 0 1px #9ca3af;
}
```

## Style Editing

When an editor is open, the cell is marked with
`data-cell-status="editing"`.

```css
.projectGrid [data-grid-part="cell"][data-cell-status="editing"] {
  background: white;
  box-shadow: inset 0 0 0 2px #16a34a;
  z-index: 3;
}
```

Editing state should usually take precedence over range selection for the same
cell.

## Style Hover and Phantom Rows

Hover is for discoverability. Keep it lower priority than active or selected
row states.

```css
.projectGrid
  [data-grid-part="row"]:not([data-row-selected="true"]):not(
    [data-row-active="true"]
  ):hover {
  background: #f7f7f7;
}
```

Phantom rows are rows created by insertion flows before they are saved.

```css
.projectGrid [data-grid-part="row"][data-row-kind="phantom"] {
  background: #fff7ed;
}
```

## Styling Contract

### Row Attributes

```html
<div
  data-grid-part="row"
  data-row-kind="data"
  data-row-active="true"
  data-row-selected="true"
  data-row-interaction-status="cursor-selected"
  data-row-selectable="true"
  aria-selected="true"
/>
```

| Attribute                     | Meaning                                              |
| ----------------------------- | ---------------------------------------------------- |
| `data-grid-part="row"`        | Identifies a body row.                               |
| `data-row-kind`               | Row kind, such as `data` or `phantom`.               |
| `data-row-active="true"`      | This row is the current row.                         |
| `data-row-selected="true"`    | This row is in the effective row selection.          |
| `data-row-interaction-status` | Combined row cursor and row selection status.        |
| `data-row-selectable`         | Whether row-operation selection can target this row. |
| `aria-selected="true"`        | Present when the row is selected.                    |

Prefer `data-row-active` and `data-row-selected` for styling. Use
`data-row-interaction-status` only when one combined status value is genuinely
more convenient.

### Cell Attributes

```html
<div
  role="gridcell"
  data-grid-part="cell"
  data-cell-status="focus"
  data-col-id="name"
/>
```

| Attribute                         | Meaning                       |
| --------------------------------- | ----------------------------- |
| `data-grid-part="cell"`           | Identifies a body cell.       |
| `data-cell-status="focus"`        | The active cell.              |
| `data-cell-status="in-selection"` | A cell in the selected range. |
| `data-cell-status="editing"`      | A cell with an open editor.   |
| `data-col-id`                     | Column id.                    |

### Level Attributes

```html
<div
  data-grid-part="root"
  data-grid-path="projects"
  data-grid-depth="0"
  data-active="true"
/>
```

| Attribute               | Meaning                                    |
| ----------------------- | ------------------------------------------ |
| `data-grid-part="root"` | Identifies a grid level root.              |
| `data-grid-path`        | Stable logical path for this level.        |
| `data-grid-depth`       | Nesting depth, with root at `0`.           |
| `data-active`           | Whether this level owns the active cursor. |

## Precedence

When multiple rules can apply, order application CSS from broad to specific:

1. base row and phantom row
2. hover row
3. selected row
4. active row
5. active + selected row
6. cell range
7. active cell
8. editing cell

The Sapporta preset follows the same visual order with low-specificity
selectors, so normal application selectors such as
`.projectGrid [data-grid-part="row"][data-row-active="true"]` override it.
