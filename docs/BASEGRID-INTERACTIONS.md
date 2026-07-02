# BaseGrid Interactions

BaseGrid's interaction system controls how the keyboard and mouse navigate a grid. It answers two questions:

- **Where does the next Arrow key start?** — this is the _cursor_.
- **Which rows are operation targets?** — this is the _selection_.

These are separate values. A checkbox click can toggle a row into a selection without moving the keyboard cursor. An Arrow key can move the cursor without changing which rows are selected. The interaction config you pass to the runtime determines which of these concepts exist and how they behave.

If you are starting a custom grid screen, read
[Building a Grid from Scratch with BaseGrid](./BASEGRID-GUIDE.md#build-a-custom-grid-screen)
first. This page helps you choose keyboard, cursor, and selection behavior after
the screen has a live grid setup.

## Quick Chooser

| Desired UX                                                    | Preset                                      | Notes                                                            |
| ------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| Editable spreadsheet                                          | `CELL_EDITING_GRID`                         | Default. Active cell plus cell range selection.                  |
| Editable spreadsheet without range selection                  | `CELL_EDITING_NO_SELECTION_GRID`            | Shift+Arrow moves without creating a range.                      |
| Editable spreadsheet with active-row highlighting             | `CELL_GRID_WITH_ACTIVE_ROW`                 | Active row derives from the active cell.                         |
| Editable spreadsheet with bulk row checkboxes                 | `CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION`  | Cell cursor and row selection are independent.                   |
| Editable spreadsheet with side panel following cursor row     | `CELL_PRIMARY_WITH_SIDE_PANEL_ROW`          | Effective row selection follows the active row.                  |
| Editable spreadsheet with independently pinned side-panel row | `CELL_PRIMARY_WITH_SELECTED_SIDE_PANEL_ROW` | Space chooses the side-panel row without moving the cell cursor. |
| Master-detail row list                                        | `ROW_PRIMARY_MASTER_DETAIL`                 | No cell editing. Arrow keys move the row cursor.                 |
| Multi-select row list                                         | `ROW_MULTISELECT_LIST`                      | Shift+Arrow extends row selection; Space toggles the active row. |

## Common Recipes

Each recipe shows the preset, the behavior, what to read, and what UI pieces you need.

### Editable Spreadsheet

```tsx
const session = useTGridSession(invoicesDefinition);
// interaction defaults to CELL_EDITING_GRID
```

- Arrow keys move the active cell. Shift+Arrow extends a cell range.
- Double-click or Enter starts editing.
- No row selection. No active row.

### Editable Spreadsheet Without Cell Ranges

```tsx
const session = useTGridSession(invoicesDefinition, {
  interaction: CELL_EDITING_NO_SELECTION_GRID,
});
```

- Arrow keys move the active cell. Shift+Arrow moves without creating a range.
- Double-click or Enter starts editing.

### Bulk Actions in an Editable Grid

```tsx
import {
  CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
} from "@sapporta/grid";
import { rowSelectionColumn } from "@sapporta/grid/column-preset";

const invoicesDefinition = defineTGrid<RowsByLevel>({
  rootLevel: "invoices",
  levels: {
    invoices: {
      table: invoicesTable,
      childLevels: [],
      query: { owner: "host", pageSize: 50 },
      columns: [
        rowSelectionColumn(), // checkbox column
        cols.table("customer_id", { header: "Customer" }),
        cols.table("invoice_date", { header: "Date" }),
        cols.table("status", { header: "Status" }),
        cols.table("amount", { header: "Amount" }),
      ],
    },
  },
});

const session = useTGridSession(invoicesDefinition, {
  interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
});
```

- Arrow keys move the active cell. Space toggles the active row in/out of selection.
- Checkboxes toggle operation targets without moving the cell cursor.
- Moving the cell cursor does not change which rows are selected.
- Read selected ids with `runtime.selectedRowIds(path)`.
- UI: add `rowSelectionColumn()` to your column list.

### Detail Panel That Follows the Cursor Row

```tsx
import { CELL_PRIMARY_WITH_SIDE_PANEL_ROW } from "@sapporta/grid";

function InvoiceWithSidePanel() {
  const session = useTGridSession(invoicesDefinition, {
    interaction: CELL_PRIMARY_WITH_SIDE_PANEL_ROW,
  });
  if (!session) return null;

  return (
    <div style={{ display: "flex" }}>
      <TGrid session={session} />
      <InvoiceDetailPanel session={session} />
    </div>
  );
  // The detail panel reads runtime.selectedRowsFor(rootPath),
  // which always returns the row the keyboard is on.
}
```

- Arrow keys move the active cell; the detail panel follows automatically.
- No checkbox or Space-bar interaction — selection is derived.
- Read the detail row with `runtime.selectedRowsFor(path)`.

### Detail Panel With Independently Pinned Row

```tsx
const session = useTGridSession(invoicesDefinition, {
  interaction: CELL_PRIMARY_WITH_SELECTED_SIDE_PANEL_ROW,
});
```

- Arrow keys move the active cell. Space pins the current row as the detail target.
- The detail panel stays on the pinned row until the user presses Space again.
- Read the pinned row with `runtime.selectedRowsFor(path)`.

### Master-Detail Row List

```tsx
import { ROW_PRIMARY_MASTER_DETAIL } from "@sapporta/grid";

function InvoiceMasterDetail() {
  const session = useTGridSession(invoicesDefinition, {
    interaction: ROW_PRIMARY_MASTER_DETAIL,
  });
  if (!session) return null;

  return (
    <div style={{ display: "flex" }}>
      <TGrid session={session} />
      <InvoiceDetailPanel session={session} />
    </div>
  );
  // Arrow keys move the row cursor. The detail panel always shows
  // the row the cursor is on. No cell editing.
}
```

- Arrow keys move the row cursor. No cell editing at all.
- The detail panel always shows the active row.
- Read with `runtime.activeRowFor(path)` or `runtime.selectedRowsFor(path)`.

### Multi-Select Row List

```tsx
import { ROW_MULTISELECT_LIST } from "@sapporta/grid";
import { rowSelectionColumn } from "@sapporta/grid/column-preset";

function InvoiceMultiSelect() {
  const session = useTGridSession(invoicesDefinition, {
    interaction: ROW_MULTISELECT_LIST,
  });
  if (!session) return null;

  const selectedIds = session.runtime.selectedRowIds(rootPath());

  return (
    <>
      <TGrid session={session} />
      <BulkActionBar
        selectedCount={selectedIds.length}
        onDelete={() => bulkDelete(selectedIds)}
      />
    </>
  );
}
```

- Arrow keys move the row cursor. Shift+Arrow extends selection.
- Space toggles the active row in/out of selection.
- Checkboxes (from `rowSelectionColumn()`) toggle independently.
- Read selected ids with `runtime.selectedRowIds(path)`.
- UI: add `rowSelectionColumn()` for checkboxes, plus an action bar.

## Mental Model

### Two Navigation Models

Choose a model based on what the keyboard should target:

- **Cell-grid** — keyboard focus is a cell. This is the spreadsheet model. Use it when cell editing matters. Arrow keys move the active cell; Shift+Arrow creates cell ranges.
- **Row-list** — keyboard focus is a row. This is the master-detail or list-selection model. Use it when the grid is a navigator, not an editor. Arrow keys move the row cursor.

Cell-grid always has an active cell and never has a row cursor. Row-list never has an active cell and never has cell selection. The `mode` field on your interaction config determines which world you are in.

### Cursor vs Selection

A cursor answers "where does the next key start?" A selection answers "what are the operation targets?" They are separate values with separate write paths:

- Cursor commands (`moveCellCursorTo`, `moveRowCursorTo`) move keyboard focus.
- Selection commands (`toggleRowSelection`, `extendRowSelectionTo`) mutate operation targets.

A checkbox click is a selection command. It never moves the cursor or changes what Arrow keys do.

The one exception is `extendRowSelectionToCursor` — the keyboard Shift+Arrow command. It moves the row cursor to the new position _and_ extends row selection from the anchor. This is inherently a hybrid: Shift+Arrow must move the cursor to the new row while also extending the selection range.

### Active Row

The active row is the row that owns keyboard focus.

- In **row-list** mode, it is a first-class concept — Arrow keys move a dedicated row cursor.
- In **cell-grid** mode, it can be derived from the active cell's row (`activeRow: { kind: "from-active-cell" }`), or absent entirely (`activeRow: { kind: "none" }`).

The canonical read is `runtime.activeRowFor(path)`. It returns a `RowCursor | null`.

### Row Selection and Sync Modes

Row selection is the set of rows that an operation (delete, export, bulk action) should apply to. It can be **derived** or **stored**:

- **`follows-active-row`** — the effective selected row is always the active row. No value is stored. Moving the active row automatically changes the effective selection. This is the master-detail pattern.
- **`independent`** — row selection is stored on the path-local controller and survives cursor movement. This is the bulk-operation pattern.

```ts
// derived: reading is always through the runtime
const selected = runtime.selectedRowsFor(path);
// When sync is "follows-active-row", this always returns
// { kind: "single", rowId: activeRow.rowId } or null.

// When sync is "independent", it returns the stored selection,
// which may contain many rows.
```

Read effective row selection through `runtime.selectedRowsFor(path)`, never by reading `controller.rowSelection` directly — when sync is `follows-active-row`, the stored value is irrelevant.

### Do Not Mix These Up

The most common implementation mistakes come from blurring the boundary between cursors and selections:

- **Active row is keyboard focus. Selected rows are operation targets.** They are different values that change for different reasons.
- **Derived selection must be read through `runtime.selectedRowsFor(path)`, never written to directly.** The runtime ignores stored values when sync is `follows-active-row`.
- **Checkbox clicks mutate selection, not cursor position.**
- **Arrow keys follow the configured mode.** The interaction mode is fixed at runtime construction; clicking a checkbox does not change key routing.
- **`extendRowSelectionToCursor` is the exception noted above** — the one command that moves the cursor and writes selection simultaneously.

## Keyboard and Mouse Behavior by Mode

### Cell-Grid

| Key         | Behavior                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Arrow keys  | Move the active cell.                                                                                      |
| Shift+Arrow | Extend the cell range (when `selectedCells.kind === "range"`), or just move (when `"none"`).               |
| Space       | Toggle the active row in/out of row selection (when enabled + independent + `space: "toggle-active-row"`). |
| Enter / F2  | Start editing the active cell.                                                                             |
| Escape      | Clear cell selection, or cancel edit.                                                                      |

| Mouse             | Behavior                             |
| ----------------- | ------------------------------------ |
| Click cell        | Move active cell cursor.             |
| Shift+Click cell  | Extend cell range.                   |
| Double-click cell | Start editing.                       |
| Click checkbox    | Toggle row selection (cursor stays). |

### Row-List

| Key               | Behavior                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Arrow Up / Down   | Move the row cursor.                                                                                       |
| Shift+Arrow       | Extend row selection (when `shiftArrows: "extend-selected-rows"`) or just move (when `"move-active-row"`). |
| Space             | Toggle the active row in/out of row selection (when enabled + independent + `space: "toggle-active-row"`). |
| Home / End        | Move to first / last row.                                                                                  |
| PageUp / PageDown | Move by page delta.                                                                                        |
| Escape            | Clear row selection.                                                                                       |

| Mouse           | Behavior                             |
| --------------- | ------------------------------------ |
| Click row       | Move row cursor to that row.         |
| Shift+Click row | Extend row selection to that row.    |
| Click checkbox  | Toggle row selection (cursor stays). |

## Presets

The presets are ordinary compositions of the config primitives. They are not special cases in the runtime — any valid `GridInteractionConfig` you construct yourself works the same way.

For full keyboard and mouse behavior, see the [cell-grid](#cell-grid) and [row-list](#row-list) tables above. Each preset description below explains how it configures those tables.

### Cell-Grid Presets

#### `CELL_EDITING_GRID`

A plain spreadsheet with cell ranges. No row selection at all. This is the default when you omit `interaction`.

Cell-grid defaults: `selectedCells: "range"`, `activeRow: "none"`, `selectedRows: "none"`. Shift+Arrow extends a cell range. Space does nothing to row selection.

```ts
{
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "none" },
  selectedRows: { kind: "none" },
}
```

```tsx
function InvoiceSpreadsheet() {
  // interaction defaults to CELL_EDITING_GRID
  const session = useTGridSession(invoicesDefinition);
  if (!session) return null;
  return <TGrid session={session} />;
}
```

#### `CELL_EDITING_NO_SELECTION_GRID`

A spreadsheet without cell range selection.

`selectedCells: "none"`. Shift+Arrow moves the active cell without creating a range. Use this when you want cell editing but no visual range selection.

```ts
{
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "none" },
  activeRow: { kind: "none" },
  selectedRows: { kind: "none" },
}
```

#### `CELL_GRID_WITH_ACTIVE_ROW`

A spreadsheet with a derived active row. Useful for highlighting or driving a side panel.

`activeRow: "from-active-cell"`. The active cell's row is available through `runtime.activeRowFor(path)`. No row selection.

```ts
{
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: { kind: "none" },
}
```

```tsx
function InvoiceWithHighlight() {
  const session = useTGridSession(invoicesDefinition, {
    interaction: CELL_GRID_WITH_ACTIVE_ROW,
  });
  if (!session) return null;
  return <TGrid session={session} />;
  // The active cell's row is available through
  // runtime.activeRowFor(path) for styling or a side panel.
}
```

#### `CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION`

A spreadsheet plus checkbox-based multi-row selection for bulk operations.

`activeRow: "from-active-cell"`, `selectedRows: enabled / multi / independent / space: toggle`. Space toggles the active row in/out of selection. Checkboxes toggle operation targets without moving the cell cursor. Moving the cell cursor does not change which rows are selected.

```ts
{
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: {
    kind: "enabled",
    mode: "multi",
    sync: { kind: "independent" },
    keyboard: { space: "toggle-active-row" },
  },
}
```

#### `CELL_PRIMARY_WITH_SIDE_PANEL_ROW`

A spreadsheet with a side panel that always shows the active row's detail. Row selection follows the active row — the detail panel is always in sync with keyboard navigation.

`selectedRows: enabled / single / follows-active-row / space: ignore`. Space is ignored because selection is derived. `runtime.selectedRowsFor(path)` always returns the active row.

```ts
{
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "follows-active-row" },
    keyboard: { space: "ignore" },
  },
}
```

#### `CELL_PRIMARY_WITH_SELECTED_SIDE_PANEL_ROW`

A spreadsheet with a side panel whose row can be picked independently. Use this when the detail panel should show a different row than the one the keyboard is on.

`selectedRows: enabled / single / independent / space: toggle`. Space toggles the active cell's row as the side-panel target without moving the cell cursor.

```ts
{
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "independent" },
    keyboard: { space: "toggle-active-row" },
  },
}
```

### Row-List Presets

#### `ROW_PRIMARY_MASTER_DETAIL`

A classic master-detail row list. Arrow keys move the active row; the detail panel shows the active row.

`shiftArrows: "move-active-row"`, `selectedRows: enabled / single / follows-active-row / space: ignore`. Shift+Arrow just moves the cursor. Space is ignored. Selection is always the active row.

```ts
{
  mode: "row-list",
  activeCell: { kind: "none" },
  selectedCells: { kind: "none" },
  activeRow: {
    kind: "from-row-cursor",
    keyboard: { arrows: "move-active-row", shiftArrows: "move-active-row" },
  },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "follows-active-row" },
    keyboard: { space: "ignore" },
  },
}
```

#### `ROW_MULTISELECT_LIST`

A multi-select row list. Shift+Arrow extends the row selection range. Space toggles the active row. Checkboxes can coexist for pointer-driven selection.

`shiftArrows: "extend-selected-rows"`, `selectedRows: enabled / multi / independent / space: toggle`. Shift+Arrow moves the cursor and extends selection. Space toggles the active row. Checkboxes toggle independently.

```ts
{
  mode: "row-list",
  activeCell: { kind: "none" },
  selectedCells: { kind: "none" },
  activeRow: {
    kind: "from-row-cursor",
    keyboard: {
      arrows: "move-active-row",
      shiftArrows: "extend-selected-rows",
    },
  },
  selectedRows: {
    kind: "enabled",
    mode: "multi",
    sync: { kind: "independent" },
    keyboard: { space: "toggle-active-row" },
  },
}
```

## Custom Configs

The presets are examples, not special cases. You can compose any valid `GridInteractionConfig` from the same primitives.

Use `satisfies GridInteractionConfig` to get compile-time validation:

```ts
import { type GridInteractionConfig } from "@sapporta/grid";

// A cell-grid with single-mode independent row selection,
// pointer-only (Space does nothing).
const MY_CONFIG = {
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "independent" },
    keyboard: { space: "ignore" },
  },
} satisfies GridInteractionConfig;

// A row-list where Shift+Arrow just moves the cursor (no range extension),
// and Space toggles the active row for independent single selection.
const MY_ROW_CONFIG = {
  mode: "row-list",
  activeCell: { kind: "none" },
  selectedCells: { kind: "none" },
  activeRow: {
    kind: "from-row-cursor",
    keyboard: {
      arrows: "move-active-row",
      shiftArrows: "move-active-row",
    },
  },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "independent" },
    keyboard: { space: "toggle-active-row" },
  },
} satisfies GridInteractionConfig;
```

The runtime validates at construction time too — `normalizeInteraction` calls `assertValidInteraction`, which catches invalid combinations (e.g. row-list mode with an active cell) even if TypeScript is bypassed.

If you pass `undefined` for the interaction argument, `normalizeInteraction` defaults to `CELL_EDITING_GRID`.

## Runtime and React APIs

### Reading State

```ts
import {
  rootPath,
  useActiveCell,
  useActiveCellForPath,
  useActiveRow,
  useCellSelection,
  useGridRuntime,
  useRowInteractionSnapshot,
  useSelectedRowIds,
  useSelectedRows,
  rowInteractionStatusFor,
} from "@sapporta/grid";

function MyComponent() {
  const runtime = useGridRuntime();
  const path = rootPath("tasks");
  const rowId = runtime.displayedRowSequenceFor(path).rows[0]?.id;

  // The normalized interaction config
  runtime.interaction; // GridInteractionConfig

  // The active row for a path
  runtime.activeRowFor(path); // RowCursor | null

  // The effective selected rows for a path
  runtime.selectedRowsFor(path); // RowSelection

  // Selected row ids in displayed order
  runtime.selectedRowIds(path); // readonly RowId[]

  // Path-level row chrome state
  const rowInteraction = runtime.rowInteractionSnapshotFor(path);
  // {
  //   activeRowId: RowId | null,
  //   selectedRowIds: readonly RowId[],
  //   statusByRowId: ReadonlyMap<RowId, RowInteractionStatus>
  // }

  if (rowId) {
    // Combined cursor + selection status for row chrome
    rowInteractionStatusFor(rowId, rowInteraction);
    // "idle" | "selected" | "cursor" | "cursor-selected"
  }
}
```

React components should use the exported hooks for subscription-backed reads:

```tsx
function TaskSelectionSummary() {
  const path = rootPath("tasks");
  const activeCell = useActiveCell(); // CellCursor | null
  const activeCellInPath = useActiveCellForPath(path); // Coord | null
  const cellSelection = useCellSelection(path); // CellSelectionState | null
  const activeRow = useActiveRow(path); // RowCursor | null
  const selectedRows = useSelectedRows(path); // RowSelection
  const selectedRowIds = useSelectedRowIds(path); // readonly RowId[]
  const rowInteraction = useRowInteractionSnapshot(path); // RowInteractionSnapshot

  return (
    <section>
      <p>Active path: {activeCell?.path ?? "none"}</p>
      <p>Active column: {activeCellInPath?.colId ?? "none"}</p>
      <p>
        Cell range:{" "}
        {cellSelection
          ? `${cellSelection.anchor.rowId}:${cellSelection.anchor.colId} to ${cellSelection.head.rowId}:${cellSelection.head.colId}`
          : "none"}
      </p>
      <p>Active row: {activeRow?.rowId ?? "none"}</p>
      <p>Selected row shape: {selectedRows?.kind ?? "none"}</p>
      <p>Selected rows: {selectedRowIds.length}</p>
      <p>Row chrome source: {rowInteraction.activeRowId ?? "none"}</p>
    </section>
  );
}
```

### Subscriptions

Each subscription returns an unsubscribe function. They fire only when the relevant value changes.

```ts
const unsubActive = runtime.subscribeActiveRow(path, () => {
  const row = runtime.activeRowFor(path);
  console.log("Active row:", row?.rowId);
});

const unsubSelected = runtime.subscribeSelectedRowIds(path, () => {
  const ids = runtime.selectedRowIds(path);
  console.log("Selected count:", ids.length);
});

const unsubInteraction = runtime.subscribeRowInteractionSnapshot(path, () => {
  const snapshot = runtime.rowInteractionSnapshotFor(path);
  console.log("Active row:", snapshot.activeRowId);
});

// Combined per-row status is derived from the path-level snapshot.
const status = rowInteractionStatusFor(
  rowId,
  runtime.rowInteractionSnapshotFor(path),
);

// Clean up
unsubActive();
unsubSelected();
unsubInteraction();
```

### Row Interaction Commands

Commands on `runtime.rowInteraction`:

```ts
// Cursor commands — move the keyboard target.
// Only valid in row-list mode.
runtime.rowInteraction.setRowCursor({ path, rowId });
runtime.rowInteraction.clearRowCursor();

// Selection commands — mutate operation targets.
// Never move the cursor (except extendRowSelectionToCursor, which
// moves the cursor as part of Shift+Arrow keyboard extension).
runtime.rowInteraction.selectRow(path, rowId);
runtime.rowInteraction.setRowSelection(path, selection);
runtime.rowInteraction.toggleRowSelection(path, rowId);
runtime.rowInteraction.extendRowSelectionTo(path, rowId);
runtime.rowInteraction.extendRowSelectionToCursor({ path, rowId });
runtime.rowInteraction.clearRowSelection(path);
```

| Command                      | Moves cursor? | Writes selection? | When                                |
| ---------------------------- | :-----------: | :---------------: | ----------------------------------- |
| `setRowCursor`               |       ✓       |         ✗         | Row-list mode                       |
| `clearRowCursor`             |       ✓       |         ✗         | Row-list mode                       |
| `selectRow`                  |       ✗       |         ✓         | Row selection enabled + independent |
| `setRowSelection`            |       ✗       |         ✓         | Row selection enabled + independent |
| `toggleRowSelection`         |       ✗       |         ✓         | Row selection enabled + independent |
| `extendRowSelectionTo`       |       ✗       |         ✓         | Row selection enabled + independent |
| `extendRowSelectionToCursor` |       ✓       |         ✓         | Row-list + shiftArrows extends      |
| `clearRowSelection`          |       ✗       |         ✓         | Row selection enabled + independent |

- `selectRow` sets selection to a single row.
- `setRowSelection` writes an arbitrary `RowSelection`. Normalizes against displayed rows and the configured mode before writing.
- `toggleRowSelection` adds a row if absent, removes it if present.
- `extendRowSelectionTo` extends from an existing anchor to the given row. For pointer/checkbox Shift+Click.
- `extendRowSelectionToCursor` moves the row cursor and extends selection from the anchor. For keyboard Shift+Arrow.
- `clearRowSelection` resets stored selection to `null`.

Selection commands no-op when row selection is disabled or when sync is `follows-active-row` (because stored writes would be ignored anyway).

### Row Interaction Status (React)

The base grid exposes row-level data attributes for styling without prescribing chrome:
`GridLevel` subscribes once to the path-level row interaction snapshot, derives
each row's status while mapping displayed rows, and passes that status to the
row shell.

```tsx
<div
  data-grid-part="row"
  data-row-id={row.id}
  data-row-kind={row.kind}
  data-row-active={active ? "true" : undefined}
  data-row-selected={selected ? "true" : undefined}
  data-row-interaction-status={status}
  data-row-selectable={String(capabilitiesFor(row.kind).rowSelectable)}
  aria-selected={selected ? true : undefined}
  role="row"
>
```

Status values:

| Status              | Meaning                                 |
| ------------------- | --------------------------------------- |
| `"idle"`            | Row is neither the cursor nor selected. |
| `"selected"`        | Row is selected but is not the cursor.  |
| `"cursor"`          | Row is the cursor but is not selected.  |
| `"cursor-selected"` | Row is both the cursor and selected.    |

### Selector Columns

The base grid does not render checkboxes. Row-selection chrome is a ColumnPreset concern — it builds a normal `ColumnSchema` that consumes the row status already derived by `GridRow`.

Prepend `rowSelectionColumn()` to your column list (see the [Bulk Actions recipe](#bulk-actions-in-an-editable-grid) for a complete example). The checkbox cell renderer:

1. Reads checked state from the current row interaction status.
2. Calls `runtime.rowInteraction.toggleRowSelection(path, row.id)` on plain click.
3. Calls `runtime.rowInteraction.extendRowSelectionTo(path, row.id)` on Shift+Click.
4. Calls `stopPropagation` and `preventDefault` so the click does not propagate to row or cell handlers.
5. Disables the checkbox when `capabilitiesFor(row.kind).rowSelectable` is `false`.

Because the selector column is ordinary `ColumnSchema`, the base grid renders it like any other column.

## Row Selection Shapes

`RowSelection` is the value type for row operation targets:

```ts
type RowSelection =
  | null // nothing selected
  | { kind: "single"; rowId: RowId } // exactly one row
  | { kind: "range"; anchor: RowId; head: RowId } // contiguous range
  | { kind: "set"; rowIds: ReadonlySet<RowId> }; // arbitrary membership
```

- **`null`** — nothing selected. Empty sets are always `null`, never `{ kind: "set", rowIds: emptySet }`.
- **`single`** — exactly one row. Created by `makeSingleRowSelection(rowId)`.
- **`range`** — a contiguous range defined by anchor and head. The range is interpreted against current displayed-row order, so sorting or filtering can change which rows lie between the endpoints. Created by `makeRowRangeSelection(anchor, head)`.
- **`set`** — arbitrary membership for multi-row toggling. Created by `makeRowSetSelection(rowIds)`. Duplicate ids are de-duped. Empty input returns `null`.

The `mode` field in `SelectedRowsConfig` constrains which shapes survive normalization:

| Mode       | Allowed shapes                                       |
| ---------- | ---------------------------------------------------- |
| `"single"` | `null` or `{ kind: "single" }`                       |
| `"range"`  | `null`, `{ kind: "single" }`, or `{ kind: "range" }` |
| `"multi"`  | Any non-null shape: `single`, `range`, or `set`      |

```ts
import {
  makeSingleRowSelection,
  makeRowRangeSelection,
  makeRowSetSelection,
} from "@sapporta/grid";

const none = null;
const one = makeSingleRowSelection("row-42");
const span = makeRowRangeSelection("row-10", "row-20");
const picked = makeRowSetSelection(["row-1", "row-5", "row-9"]);
const empty = makeRowSetSelection([]); // returns null
```

### Row Selectability

Not all rows are eligible for row selection. The `rowSelectable` capability gate controls this:

| Row kind | `selectable` (cell ranges) | `rowSelectable` (row operations) |
| -------- | :------------------------: | :------------------------------: |
| data     |             ✓              |                ✓                 |
| rollup   |             ✓              |                ✓                 |
| opening  |             ✗              |                ✗                 |
| closing  |             ✗              |                ✗                 |
| subtotal |             ✓              |                ✗                 |
| footer   |             ✗              |                ✗                 |
| phantom  |             ✓              |                ✓                 |

A subtotal row can participate in a visual cell range but is never a target for row operations like delete or export. The row-selection helpers (`rowIdsInRowSelection`, `normalizeRowSelection`) automatically filter out non-row-selectable rows.

## For Maintainers

This section covers internal invariants that application programmers can skip unless they are modifying the interaction runtime.

### Invariants

- `runtime.interaction` is always normalized and present after construction.
- `coordinator.cellCursor` and `controller.liveCellFocus` are written only by `CursorManager` cell methods.
- `coordinator.rowCursor` and `controller.liveRowFocus` are written only by `CursorManager` row methods.
- In cell-grid mode, `coordinator.rowCursor` and `liveRowFocus` remain `null`.
- In row-list mode, `coordinator.cellCursor`, `liveCellFocus`, `cellSelection`, and `editing` remain `null`.
- Stored row selections contain only currently displayed, row-selectable row ids.
- Cursor movement does not mutate stored row selection. Effective `follows-active-row` selection may change because it is derived.
- Pure selection commands (`selectRow`, `toggleRowSelection`, `extendRowSelectionTo`, `setRowSelection`, `clearRowSelection`) do not move any cursor. `extendRowSelectionToCursor` is the exception — it moves the row cursor as part of the Shift+Arrow keyboard path.
- Displayed-row changes may prune row selection. Selection changes never invalidate displayed rows.

---

## API Reference

### Types

#### `GridInteractionConfig`

```ts
type GridInteractionConfig =
  | CellGridInteractionConfig
  | RowListInteractionConfig;
```

Discriminated union on `mode`. Pass to `createGridRuntime({ interaction })` or `useTGridSession(def, { interaction })`.

#### `CellGridInteractionConfig`

```ts
type CellGridInteractionConfig = {
  mode: "cell-grid";
  activeCell: { kind: "enabled" };
  selectedCells: SelectedCellsConfig;
  activeRow: CellGridActiveRowConfig;
  selectedRows: SelectedRowsConfig;
};
```

#### `RowListInteractionConfig`

```ts
type RowListInteractionConfig = {
  mode: "row-list";
  activeCell: { kind: "none" };
  selectedCells: { kind: "none" };
  activeRow: RowListActiveRowConfig;
  selectedRows: SelectedRowsConfig;
};
```

#### `RowSelectionMode`

```ts
type RowSelectionMode = "single" | "range" | "multi";
```

Constrains which `RowSelection` shapes survive normalization. See [Row Selection Shapes](#row-selection-shapes) for the mapping from mode to allowed shapes.

#### `SelectedRowsSync`

```ts
type SelectedRowsSync =
  | { kind: "follows-active-row" }
  | { kind: "independent" };
```

See [Row Selection and Sync Modes](#row-selection-and-sync-modes).

#### `SelectedRowsKeyboardConfig`

```ts
type SelectedRowsKeyboardConfig = {
  space: "toggle-active-row" | "ignore";
};
```

- `"toggle-active-row"` — Space toggles the active row in/out of the stored selection. Only meaningful when row selection is enabled and independent.
- `"ignore"` — Space does nothing to row selection. Use when selection follows the active row or when only pointer-based selection is desired.

#### `SelectedRowsConfig`

```ts
type SelectedRowsConfig =
  | { kind: "none" }
  | {
      kind: "enabled";
      mode: RowSelectionMode;
      sync: SelectedRowsSync;
      keyboard: SelectedRowsKeyboardConfig;
    };
```

See [Row Selection and Sync Modes](#row-selection-and-sync-modes) for `sync`, and [Row Selection Shapes](#row-selection-shapes) for how `mode` constrains allowed shapes.

#### `SelectedCellsConfig`

```ts
type SelectedCellsConfig = { kind: "none" } | { kind: "range" };
```

- `"none"` — no cell range selection. Shift+Arrow and Shift+Click move the cursor without creating a range.
- `"range"` — Shift+Arrow and Shift+Click create/extend a cell range.

#### `CellGridActiveRowConfig`

```ts
type CellGridActiveRowConfig = { kind: "none" } | { kind: "from-active-cell" };
```

See [Active Row](#active-row).

#### `ActiveRowKeyboardConfig`

```ts
type ActiveRowKeyboardConfig = {
  arrows: "move-active-row";
  shiftArrows: "extend-selected-rows" | "move-active-row";
};
```

Controls whether Shift+Arrow extends row selection — see the [row-list keyboard table](#row-list).

#### `RowListActiveRowConfig`

```ts
type RowListActiveRowConfig = {
  kind: "from-row-cursor";
  keyboard: ActiveRowKeyboardConfig;
};
```

#### `RowSelection`

```ts
type RowSelection =
  | null
  | { kind: "single"; rowId: RowId }
  | { kind: "range"; anchor: RowId; head: RowId }
  | { kind: "set"; rowIds: ReadonlySet<RowId> };
```

See [Row Selection Shapes](#row-selection-shapes).

#### `RowCursor`

```ts
type RowCursor = {
  path: GridPath;
  rowId: RowId;
};
```

#### `RowInteractionStatus`

```ts
type RowInteractionStatus = "idle" | "selected" | "cursor" | "cursor-selected";
```

See [Row Interaction Status](#row-interaction-status-react).

#### `RowInteractionSnapshot`

```ts
type RowInteractionSnapshot = {
  activeRowId: RowId | null;
  selectedRowIds: readonly RowId[];
  statusByRowId: ReadonlyMap<RowId, RowInteractionStatus>;
};
```

Path-level snapshot used to derive row chrome. `GridLevel` subscribes to this
once for the rendered path and computes each row's `RowInteractionStatus` while
mapping rows.

#### `CellNavigationIntent`

```ts
type CellNavigationIntent =
  | { type: "commitMove"; target: Exclude<CommitTarget, "stay"> }
  | {
      type: "moveColumn";
      direction: "left" | "right" | "rowStart" | "rowEnd";
      extend: boolean;
    }
  | {
      type: "moveRow";
      direction: "up" | "down";
      colPolicy: ColPolicy;
      extend: boolean;
    }
  | {
      type: "moveRowDelta";
      delta: number;
      colPolicy: "preserve";
      extend: boolean;
    }
  | {
      type: "moveGridEdge";
      edge: "first" | "last";
      colPolicy: "preserve";
      extend: boolean;
    }
  | { type: "startEdit"; coord: Coord; trigger: "type"; initial: string }
  | { type: "startEdit"; coord: Coord; trigger: NonTypedCellEditGesture }
  | { type: "activateCell"; coord: Coord; trigger: CellActivationTrigger }
  | { type: "clearCellSelection" }
  | { type: "focusFirstCell" }
  | { type: "toggleActiveRowSelection" };
```

#### `RowNavigationIntent`

```ts
type RowNavigationIntent =
  | { type: "moveActiveRow"; direction: "up" | "down"; extend: boolean }
  | { type: "moveActiveRowDelta"; delta: number; extend: boolean }
  | { type: "moveActiveRowEdge"; edge: "first" | "last"; extend: boolean }
  | { type: "focusFirstRow" }
  | { type: "toggleActiveRowSelection" }
  | { type: "clearRowSelection" };
```

### Constructors

#### `makeRowCursor`

```ts
function makeRowCursor(path: GridPath, rowId: RowId): RowCursor;
```

#### `makeSingleRowSelection`

```ts
function makeSingleRowSelection(rowId: RowId): RowSelection;
```

#### `makeRowRangeSelection`

```ts
function makeRowRangeSelection(anchor: RowId, head: RowId): RowSelection;
```

#### `makeRowSetSelection`

```ts
function makeRowSetSelection(rowIds: Iterable<RowId>): RowSelection;
```

De-duplicates by `Set`. Empty input returns `null`.

#### `rowSelectionColumn`

```ts
function rowSelectionColumn(options?: RowSelectionColumnOptions): ColumnSchema;
```

Returns a `ColumnSchema` for a checkbox selector column. See the [Bulk Actions recipe](#bulk-actions-in-an-editable-grid) for a complete example.

```ts
type RowSelectionColumnOptions = {
  id?: ColId; // default: "__row_selection"
  name?: string; // default: ""
  width?: ColumnWidth; // default: "compact"
  header?: "checkbox" | "blank";
};
```

### Preset Constants

All typed with `satisfies GridInteractionConfig`.

| Constant                                    | Mode      | Cell selection | Active row                      | Row selection                                  |
| ------------------------------------------- | --------- | -------------- | ------------------------------- | ---------------------------------------------- |
| `CELL_EDITING_GRID`                         | cell-grid | range          | none                            | none                                           |
| `CELL_EDITING_NO_SELECTION_GRID`            | cell-grid | none           | none                            | none                                           |
| `CELL_GRID_WITH_ACTIVE_ROW`                 | cell-grid | range          | from-active-cell                | none                                           |
| `CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION`  | cell-grid | range          | from-active-cell                | enabled / multi / independent / space: toggle  |
| `CELL_PRIMARY_WITH_SIDE_PANEL_ROW`          | cell-grid | range          | from-active-cell                | enabled / single / follows / space: ignore     |
| `CELL_PRIMARY_WITH_SELECTED_SIDE_PANEL_ROW` | cell-grid | range          | from-active-cell                | enabled / single / independent / space: toggle |
| `ROW_PRIMARY_MASTER_DETAIL`                 | row-list  | none           | from-row-cursor / shift: move   | enabled / single / follows / space: ignore     |
| `ROW_MULTISELECT_LIST`                      | row-list  | none           | from-row-cursor / shift: extend | enabled / multi / independent / space: toggle  |

### Functions

#### `normalizeInteraction`

```ts
function normalizeInteraction(
  interaction?: GridInteractionConfig,
): GridInteractionConfig;
```

Defaults to `CELL_EDITING_GRID` when `undefined`. Calls `assertValidInteraction`.

#### `assertValidInteraction`

```ts
function assertValidInteraction(interaction: GridInteractionConfig): void;
```

Throws if cell-grid mode lacks an active cell, or row-list mode has an active cell or selected cells.

#### `activeRowFor`

```ts
function activeRowFor(
  config: GridInteractionConfig,
  cellCursor: CellCursor | null,
  liveRowFocus: RowId | null,
  path: GridPath,
): RowCursor | null;
```

Pure function. Returns the canonical active row for a given path.

#### `selectedRowsFor`

```ts
function selectedRowsFor(
  config: GridInteractionConfig,
  activeRow: RowCursor | null,
  storedSelection: RowSelection,
): RowSelection;
```

Pure function. Returns the effective selected rows. When sync is `follows-active-row`, derives from `activeRow` and ignores `storedSelection`.

#### `rowIdsInRowSelection`

```ts
function rowIdsInRowSelection(
  selection: RowSelection,
  displayed: DisplayedRows,
): readonly RowId[];
```

Projects selection into an ordered list of displayed, row-selectable ids.

#### `normalizeRowSelection`

```ts
function normalizeRowSelection(
  selection: RowSelection,
  displayed: DisplayedRows,
  mode: RowSelectionMode,
): RowSelection;
```

Prunes missing/non-row-selectable ids. Collapses shapes that exceed the allowed `mode`. Preserves object identity on no-op writes.

#### `rowCursorEqual`

```ts
function rowCursorEqual(a: RowCursor | null, b: RowCursor | null): boolean;
```

### Capabilities

```ts
type RowCapabilities = {
  editable: boolean;
  focusable: boolean;
  selectable: boolean; // gates cell range selection
  rowSelectable: boolean; // gates row operation selection
  hasContextMenu: boolean;
  canExpand: boolean;
};

function capabilitiesFor(kind: LevelRowKind): RowCapabilities;
function capabilitiesOf(row: LevelRow): RowCapabilities;
```
