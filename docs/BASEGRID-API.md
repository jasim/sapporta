# BaseGrid API Reference

This reference is organized in the order you normally build a BaseGrid:

1. define identity and paths
2. define schema and columns
3. choose ColumnPreset or raw columns
4. provide a data source
5. create a runtime
6. render with React
7. read and write through the runtime
8. configure interactions

For a tutorial, read [BASEGRID-GUIDE.md](./BASEGRID-GUIDE.md). For detailed
keyboard and selection behavior, read
[BASEGRID-INTERACTIONS.md](./BASEGRID-INTERACTIONS.md).

## Import Surface

The BaseGrid and ColumnPreset APIs are exported from `@sapporta/ui`.

```ts
import {
  GridLevel,
  GridRuntimeProvider,
  createGridRuntime,
  inMemoryGridDataSource,
  rootPath,
  text,
  useActiveCell,
  useActiveCellForPath,
  useActiveRow,
  useCellSelection,
  useSelectedRowIds,
  useSelectedRows,
  type GridSchema,
  type TreeNode,
} from "@sapporta/ui";
```

Do not use TGrid APIs when you are building a BaseGrid from scratch. TGrid
adapts Sapporta table schemas and table row APIs onto BaseGrid; this reference
covers the lower-level primitives.

## Identity API

BaseGrid uses stable logical identifiers rather than array indexes.

```ts
type ColId = string;
type RowKey = string;
type GridPath = Brand<string, "GridPath">;
type RowId = Brand<string, "RowId">;
type Coord = { rowId: RowId; colId: ColId };
type CellCursor = { path: GridPath; rowId: RowId; colId: ColId };
```

### `rootPath`

```ts
function rootPath(rootLevelName: string): GridPath;
```

Creates the root path for a level.

```ts
const projectsPath = rootPath("projects");
```

### `childPath`

```ts
function childPath(
  parent: GridPath,
  parentRowKey: RowKey,
  childKey: string,
): GridPath;
```

Creates the path for a child level under a parent row.

```ts
const tasksPath = childPath(rootPath("projects"), "project-1", "tasks");
```

### `makeRowId`

```ts
function makeRowId(path: GridPath, rowKey: RowKey): RowId;
```

Creates the row id used by focus, selection, and displayed-row lookups.

```ts
const rowId = makeRowId(rootPath("projects"), "project-1");
```

### Path Helpers

```ts
function decomposePath(path: GridPath): PathDecomposition;
function trailingEdge(path: GridPath): {
  parentPath: GridPath;
  parentRowKey: RowKey;
  childLevelName: string;
} | null;
function parseChildPath(
  parent: GridPath,
  child: GridPath,
): { rowKey: RowKey; childKey: string } | null;
function pathOfRowId(id: RowId): GridPath;
function rowKeyOfRowId(id: RowId): RowKey;
function coordsEqual(a: Coord, b: Coord): boolean;
function cursorEqual(a: CellCursor | null, b: CellCursor | null): boolean;
```

Use these helpers instead of parsing path strings yourself.

## Schema API

The schema is static. It defines level names, columns, child level names, and
level options.

```ts
type GridSchema = {
  levels: Record<string, LevelSchema>;
  rootLevel: string;
};

type LevelSchema = {
  name: string;
  columns: ColumnSchema[];
  options: LevelOptions;
  childLevels: string[];
};
```

### `LevelOptions`

```ts
type LevelOptions = {
  rowKey?: (node: TreeNode, localIdx: number) => RowKey;
  defaultCollapsed?: boolean;
  allowPhantoms?: boolean;
};
```

`rowKey` should return a stable id for each sibling row. If you omit it, the
default row key is the local array index. Prefer a real row id whenever rows can
be sorted, filtered, inserted, deleted, or refreshed.

```ts
const schema: GridSchema = {
  rootLevel: "projects",
  levels: {
    projects: {
      name: "projects",
      columns: projectColumns,
      childLevels: ["tasks"],
      options: { rowKey: (node) => String(node.columns.id) },
    },
    tasks: {
      name: "tasks",
      columns: taskColumns,
      childLevels: [],
      options: { rowKey: (node) => String(node.columns.id) },
    },
  },
};
```

## Row Data API

Data sources publish `TreeNode` values. Displayed rows are derived from those
nodes.

```ts
type TreeNode = {
  levelName: string;
  columns: Record<ColId, unknown>;
  rollup?: Record<ColId, unknown>;
  children?: Record<string, TreeNode | TreeNode[]>;
  childFooterRows?: Record<string, FooterRow[]>;
  kind?: "opening" | "closing" | "subtotal";
};

type FooterRow = {
  rowKey: RowKey;
  columns: Record<ColId, unknown>;
};

type PhantomRow = {
  rowKey: RowKey;
  columns: Record<ColId, unknown>;
};
```

Runtime reads return `LevelRow`, not raw `TreeNode`.

```ts
type LevelRow =
  | { kind: "data"; id: RowId; columns: Record<ColId, unknown>; source: TreeNode; hasChildren: boolean; rowSelectable: boolean }
  | { kind: "rollup"; id: RowId; columns: Record<ColId, unknown>; source: TreeNode; rowSelectable: boolean }
  | { kind: "opening" | "closing" | "subtotal"; id: RowId; columns: Record<ColId, unknown>; source: TreeNode; rowSelectable: boolean }
  | { kind: "footer"; id: RowId; columns: Record<ColId, unknown>; source: FooterRow; rowSelectable: boolean }
  | { kind: "phantom"; id: RowId; columns: Record<ColId, unknown>; source: PhantomRow; rowSelectable: boolean };
```

Branch on `row.kind` in renderers and host UI. Interaction code should use
capability helpers.

```ts
function capabilitiesFor(kind: LevelRowKind): RowCapabilities;
function capabilitiesOf(row: LevelRow): RowCapabilities;
```

## Column API

BaseGrid renders `ColumnSchema`.

```ts
type ColumnSchema = {
  id: ColId;
  name: string;
  renderCell: (props: CellRenderProps) => ReactNode;
  compare?: (a: unknown, b: unknown) => number;
  editCell?: ComponentType<CellEditorProps>;
  editTriggers?: readonly EditTrigger[];
  meta?: unknown;
};

type CellRenderProps = {
  value: unknown;
  row: LevelRow;
  column: ColumnSchema;
  path: GridPath;
};

type CellEditorProps = CellEditorStart & {
  value: unknown;
  row: LevelRow;
  column: ColumnSchema;
  path: GridPath;
  anchor: HTMLElement;
  onCommit: (newValue: unknown, commit?: CommitTarget) => void;
  onCancel: () => void;
};

type EditTrigger = "click" | "enter" | "type" | "f2";
```

### Raw Column Example

```tsx
import type { ColumnSchema } from "@sapporta/ui";

const statusColumn: ColumnSchema = {
  id: "status",
  name: "Status",
  renderCell: ({ value }) => (
    <span data-status={String(value)}>{String(value ?? "")}</span>
  ),
  compare: (a, b) => String(a ?? "").localeCompare(String(b ?? "")),
};
```

### Raw Editor Example

```tsx
import { useState } from "react";
import type { CellEditorProps, ColumnSchema } from "@sapporta/ui";

function TextEditor(props: CellEditorProps) {
  const [value, setValue] = useState(String(props.value ?? ""));

  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => props.onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onCommit(value, "down");
        if (event.key === "Escape") props.onCancel();
      }}
    />
  );
}

const titleColumn: ColumnSchema = {
  id: "title",
  name: "Title",
  renderCell: ({ value }) => String(value ?? ""),
  editCell: TextEditor,
  editTriggers: ["click", "enter", "type", "f2"],
};
```

## ColumnPreset API

ColumnPreset helpers return ordinary `ColumnSchema` values. They are the
recommended starting point for most BaseGrid columns.

### Constructors

```ts
function identifier<TMeta = unknown>(options: ColumnPresetOptions<TMeta>): ColumnSchema;
function text<TMeta = unknown>(options: TextColumnOptions<TMeta>): ColumnSchema;
function number<TMeta = unknown>(options: NumberColumnOptions<TMeta>): ColumnSchema;
function currency<TMeta = unknown>(options: NumberColumnOptions<TMeta>): ColumnSchema;
function percentage<TMeta = unknown>(options: NumberColumnOptions<TMeta>): ColumnSchema;
function date<TMeta = unknown>(options: ColumnPresetOptions<TMeta>): ColumnSchema;
function boolean<TMeta = unknown>(options: ColumnPresetOptions<TMeta>): ColumnSchema;
function select<TMeta = unknown>(options: SelectColumnOptions<TMeta>): ColumnSchema;
function lookupValue<TMeta = unknown>(options: LookupColumnOptions<TMeta>): ColumnSchema;
function foreignKey<TMeta = unknown>(options: LookupColumnOptions<TMeta>): ColumnSchema;
function column<TMeta = unknown>(options: ColumnPresetOptions<TMeta>): ColumnSchema;
```

### Common Options

```ts
type ColumnPresetOptions<TMeta = unknown> = {
  kind?: ColumnPresetKind;
  id: ColId;
  name: string;
  align?: "left" | "right" | "center";
  width?: ColumnWidth;
  editable?: boolean;
  sortable?: boolean;
  format?: (value: unknown) => string;
  parse?: (value: string, props: CellEditorProps) => unknown;
  compare?: (a: unknown, b: unknown) => number;
  renderCell?: (props: CellRenderProps) => ReactNode;
  renderCellAction?: (props: CellRenderProps) => ReactNode;
  editor?: ComponentType<CellEditorProps>;
  editTriggers?: readonly EditTrigger[];
  meta?: TMeta;
};
```

### Widths

```ts
type ColumnWidth =
  | "compact"
  | "content"
  | "fill"
  | "numeric"
  | "date"
  | "enum"
  | "foreignKey"
  | { min?: number; ideal?: number; max?: number }
  | { track: string };
```

### Select Columns

```ts
const status = select({
  id: "status",
  name: "Status",
  editable: true,
  width: "enum",
  options: [
    { value: "todo", label: "To do" },
    { value: "doing", label: "Doing" },
    { value: "done", label: "Done" },
  ],
});
```

### Number Columns

```ts
const estimate = number({
  id: "estimate",
  name: "Estimate",
  editable: true,
  width: "numeric",
  zeroDisplay: "blank",
});

const variance = currency({
  id: "variance",
  name: "Variance",
  colorRule: "signed",
});
```

### Custom Formatting

```ts
const duration = number({
  id: "durationMinutes",
  name: "Duration",
  format: (value) => `${Number(value ?? 0)} min`,
  parse: (value) => Number(value.replace("min", "").trim()),
});
```

### Row Selection Column

```ts
function rowSelectionColumn(options?: RowSelectionColumnOptions): ColumnSchema;

type RowSelectionColumnOptions = {
  id?: ColId;
  name?: string;
  width?: ColumnWidth;
  header?: "checkbox" | "blank";
};
```

`rowSelectionColumn()` renders checkbox chrome on top of the runtime's row
selection APIs.

```ts
const columns = [
  rowSelectionColumn(),
  text({ id: "title", name: "Title", editable: true }),
];
```

### ColumnPreset Helpers

```ts
function preset(column: ColumnSchema): ColumnPreset | undefined;
function meta<TMeta = unknown>(column: ColumnSchema): TMeta | undefined;
function kind(column: ColumnSchema): ColumnPresetKind | undefined;
function width(column: ColumnSchema): ColumnWidth | undefined;
function parse(column: ColumnSchema): ((value: string, props: CellEditorProps) => unknown) | undefined;
function lookupCapabilities(column: ColumnSchema): LookupCapabilities | undefined;
function trackForColumn(column: ColumnSchema): string;
function templateColumns(columns: readonly ColumnSchema[]): string;
```

Use `templateColumns` when you build custom chrome that must align with the
grid's column widths.

```tsx
const style = {
  display: "grid",
  gridTemplateColumns: templateColumns(schema.levels.tasks.columns),
};
```

## Data Source API

The runtime talks to `GridDataSource`, which creates one `LevelDataSource` per
path.

```ts
type GridDataSource = {
  rootSource: () => LevelDataSource;
  resolveChild: (
    parentPath: GridPath,
    parentRowKey: RowKey,
    childLevelName: string,
  ) => LevelDataSource;
  dispose: () => void;
};
```

### Level Snapshots

```ts
type LevelStatus = "idle" | "loading" | "error" | "ready";

type LevelSnapshot<F = unknown> = {
  status: LevelStatus;
  error?: Error;
  nodes: TreeNode[];
  footerRows?: FooterRow[];
  sort?: SortDescriptor[];
  filter?: F;
  applyFilter?: RowPredicate;
  pagination?: { page: number; pageSize: number; totalCount?: number };
  serverManaged: {
    sort: boolean;
    filter: boolean;
    pagination: boolean;
  };
};
```

`serverManaged` tells displayed-row derivation which concerns the source has
already applied. If `serverManaged.sort` is true, the runtime treats `nodes` as
already sorted.

### Readonly Sources

```ts
type ReadonlyLevelDataSource = {
  writable: false;
  snapshot(): LevelSnapshot;
  subscribe(fn: () => void): () => void;
  setSort: (sort?: SortDescriptor[]) => void;
  setFilter: (filter?: unknown) => void;
  setPage: (page: number, pageSize: number) => void;
  refetch: () => void;
  dispose(): void;
};
```

### Writable Sources

```ts
type CellChange = { rowKey: RowKey; colId: ColId; value: unknown };

type WritableLevelDataSource = Omit<ReadonlyLevelDataSource, "writable"> & {
  writable: true;
  setCell: (rowKey: RowKey, colId: ColId, value: unknown) => void;
  applyChanges: (changes: CellChange[]) => void;
  insertNode: (node: TreeNode, atIndex?: number) => void;
  removeNode: (rowKey: RowKey) => void;
  onReconcile(fn: (event: ReconcileEvent) => void): () => void;
};
```

The runtime hides write verbs behind runtime methods. App code should normally
call `runtime.writeCell`, `runtime.applyChanges`, `runtime.insertRow`, and
`runtime.removeRow`, not source write methods directly.

### Reconcile Events

```ts
type ReconcileEvent =
  | { kind: "agreed"; rowKey: RowKey; colId: ColId; value: unknown }
  | {
      kind: "diverged";
      rowKey: RowKey;
      colId: ColId;
      optimisticValue: unknown;
      authoritativeValue: unknown;
      priorValue: unknown;
    }
  | {
      kind: "rejected";
      rowKey: RowKey;
      colId: ColId;
      optimisticValue: unknown;
      reason: string;
      priorValue: unknown;
    };
```

Use reconcile events to report save conflicts, authoritative corrections, or
rejected optimistic writes.

## In-Memory Data Source

```ts
function inMemoryGridDataSource<F = unknown>(
  opts: InMemoryGridDataSourceOpts<F>,
): GridDataSource;

type InMemoryGridDataSourceOpts<F = unknown> = {
  schema: GridSchema;
  tree: TreeNode[];
  levels: { [levelName: string]: InMemoryLevelOpts<F> };
};

type InMemoryLevelOpts<F = unknown> = {
  sortMode: "client" | "none";
  filterMode: "client" | "none";
  paginationMode: "client" | "none";
  initialSort?: SortDescriptor[];
  initialFilter?: F;
  initialPage?: number;
  initialPageSize?: number;
  aggregator?: InMemoryAggregator;
  compileFilter?: (filter: F | undefined) => RowPredicate | undefined;
};
```

Example:

```ts
const dataSource = inMemoryGridDataSource({
  schema,
  tree,
  levels: {
    projects: {
      sortMode: "client",
      filterMode: "none",
      paginationMode: "none",
    },
    tasks: {
      sortMode: "client",
      filterMode: "none",
      paginationMode: "none",
    },
  },
});
```

Use this source for local data, tests, demos, or as a reference implementation
for custom sources.

## Runtime Construction

```ts
type RuntimeArgs = {
  schema: GridSchema;
  dataSource: GridDataSource;
  interaction?: GridInteractionConfig;
  initialPhantomsByPath?: Map<GridPath, PhantomRow[]>;
  on?: { [E in keyof GridEvents]?: (payload: GridEvents[E]) => void };
};

function createGridRuntime(args: RuntimeArgs): GridRuntime;
```

Example:

```ts
const runtime = createGridRuntime({
  schema,
  dataSource,
  interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  on: {
    mutationCommitted(event) {
      console.log(event.kind);
    },
    levelStatusChanged({ path, status }) {
      console.log(path, status);
    },
  },
});
```

Dispose runtimes you create outside normal component lifetime:

```ts
const runtime = createGridRuntime({ schema, dataSource });

try {
  runtime.sourceFor(rootPath("projects")).refetch();
} finally {
  runtime.dispose();
}
```

## Runtime API

```ts
type GridRuntime = {
  schema: GridSchema;
  schemaTopology: SchemaTopology;
  interaction: GridInteractionConfig;
  coordinator: GridCoordinatorPublic;
  cursorManager: CursorManager;
  phantoms: PhantomChannel;

  registeredPaths(): GridPath[];
  subscribeRegistry(fn: () => void): () => void;

  schemaAt(path: GridPath): LevelSchema;
  snapshotFor(path: GridPath): LevelSnapshot;
  sourceFor(path: GridPath): RuntimeLevelDataSource;
  controllerFor(path: GridPath): GridControllerPublic;
  materializedChildren(parentPath: GridPath, rowId: RowId): GridPath[];

  displayedRowsFor(path: GridPath): DisplayedRows;
  displayedRowSequenceFor(path: GridPath): DisplayedRowSequence;
  displayedRowFor(path: GridPath, rowId: RowId): LevelRow | undefined;
  subscribeDisplayedRowSequence(path: GridPath, fn: () => void): () => void;
  subscribeDisplayedRow(path: GridPath, rowId: RowId, fn: () => void): () => void;
  invalidateDisplayedRows(path: GridPath, reason: DisplayedRowsInvalidationReason): void;

  writeCell(path: GridPath, coord: Coord, value: unknown): void;
  applyChanges(path: GridPath, changes: CellChange[]): void;
  insertRow(path: GridPath, node: TreeNode, atIndex?: number): void;
  removeRow(path: GridPath, rowKey: RowKey): void;
  commitPhantom(path: GridPath, rowKey: RowKey, atIndex?: number): void;

  on: GridEmitter["on"];
  dispose(): void;
};
```

### Displayed Rows

```ts
const path = rootPath("projects");
const rows = runtime.displayedRowsFor(path);

for (const row of rows.rows) {
  console.log(row.id, row.kind, row.columns);
}
```

Use `displayedRowSequenceFor` when you only need ordered row refs:

```ts
const sequence = runtime.displayedRowSequenceFor(path);
const ids = sequence.rows.map((row) => row.id);
```

### Writes

```ts
const path = rootPath("projects");
const rowId = makeRowId(path, "project-1");

runtime.writeCell(path, { rowId, colId: "status" }, "done");

runtime.applyChanges(path, [
  { rowKey: "project-1", colId: "status", value: "done" },
  { rowKey: "project-1", colId: "completedAt", value: "2026-06-01" },
]);

runtime.insertRow(path, {
  levelName: "projects",
  columns: { id: "project-2", name: "Migration", status: "active" },
});

runtime.removeRow(path, "project-2");
```

Write methods throw if the source for that path is readonly.

## Runtime Events

```ts
type GridEvents = {
  mutationCommitted: MutationCommittedEvent;
  cellSelectionChanged: {
    path: GridPath;
    selection: CellSelectionState | null;
  };
  rowSelectionChanged: {
    path: GridPath;
    selection: RowSelection;
  };
  cellReconciled: {
    path: GridPath;
    event: ReconcileEvent;
  };
  levelStatusChanged: {
    path: GridPath;
    status: LevelStatus;
    error?: Error;
  };
  phantomCommitted: {
    path: GridPath;
    rowKey: RowKey;
  };
};
```

Subscribe either at construction:

```ts
const runtime = createGridRuntime({
  schema,
  dataSource,
  on: {
    mutationCommitted(event) {
      audit(event);
    },
  },
});
```

or later:

```ts
const unsubscribe = runtime.on("cellReconciled", ({ event }) => {
  if (event.kind === "rejected") showSaveError(event.reason);
});
```

## React API

### `GridRuntimeProvider`

```tsx
function GridRuntimeProvider({
  runtime,
  children,
}: {
  runtime: GridRuntime;
  children: ReactNode;
}): JSX.Element;
```

Provides the runtime to BaseGrid React components and hooks.

```tsx
<GridRuntimeProvider runtime={runtime}>
  <GridLevel path={rootPath("projects")} />
</GridRuntimeProvider>
```

### `useGridRuntime`

```ts
function useGridRuntime(): GridRuntime;
```

Reads the runtime from context.

```tsx
function RefreshButton({ path }: { path: GridPath }) {
  const runtime = useGridRuntime();
  return <button onClick={() => runtime.sourceFor(path).refetch()}>Refresh</button>;
}
```

### `GridLevel`

```tsx
function GridLevel({
  path,
  chrome,
}: {
  path: GridPath;
  chrome?: GridLevelChrome;
}): JSX.Element;

type GridLevelChrome = {
  renderLevelHeader?: (ctx: GridChromeContext) => ReactNode;
  levelContainerClassName?: (ctx: GridChromeContext) => string | undefined;
  levelContainerStyle?: (ctx: GridChromeContext) => CSSProperties | undefined;
};

type GridChromeContext = {
  path: GridPath;
  levelName: string;
  schema: ColumnSchema[];
};
```

`GridLevel` renders a level and recursively mounts child levels under expanded
rows.

```tsx
<GridLevel
  path={rootPath("projects")}
  chrome={{
    renderLevelHeader: ({ levelName }) => (
      <div data-grid-part="header">{levelName}</div>
    ),
  }}
/>
```

### React Store Hooks

```ts
function useLevelSnapshot(path: GridPath): LevelSnapshot;
function usePhantoms(path: GridPath): PhantomRow[];
function useDisplayedRowSequence(path: GridPath): DisplayedRowSequence;
function useDisplayedRow(path: GridPath, rowId: RowId): LevelRow;
function useActiveCell(): CellCursor | null;
function useActiveCellForPath(path: GridPath): Coord | null;
function useCellSelection(path: GridPath): CellSelectionState | null;
function useActiveRow(path: GridPath): RowCursor | null;
function useSelectedRows(path: GridPath): RowSelection;
function useSelectedRowIds(path: GridPath): readonly RowId[];
function useRowSelectionContainsRow(path: GridPath, rowId: RowId): boolean;
function useRowInteractionStatus(path: GridPath, rowId: RowId): RowInteractionStatus;
```

Example:

```tsx
function LevelStatus({ path }: { path: GridPath }) {
  const snapshot = useLevelSnapshot(path);
  return <span>{snapshot.status}</span>;
}
```

Host components that sit next to a `GridLevel` should use these hooks instead
of subscribing to runtime internals directly:

```tsx
function TaskInspector({ path }: { path: GridPath }) {
  const activeCellInGrid = useActiveCell();
  const activeCell = useActiveCellForPath(path);
  const cellSelection = useCellSelection(path);
  const activeRow = useActiveRow(path);
  const selectedRows = useSelectedRows(path);
  const selectedRowIds = useSelectedRowIds(path);

  return (
    <aside>
      <p>Active row: {activeRow?.rowId ?? "none"}</p>
      <p>Active cell: {activeCell?.colId ?? "none"}</p>
      <p>Grid cursor path: {activeCellInGrid?.path ?? "none"}</p>
      <p>
        Cell range:{" "}
        {cellSelection
          ? `${cellSelection.anchor.rowId}:${cellSelection.anchor.colId} to ${cellSelection.head.rowId}:${cellSelection.head.colId}`
          : "none"}
      </p>
      <p>Selected row shape: {selectedRows?.kind ?? "none"}</p>
      <p>Selected rows: {selectedRowIds.length}</p>
    </aside>
  );
}
```

## Interaction API

The full interaction reference lives in
[BASEGRID-INTERACTIONS.md](./BASEGRID-INTERACTIONS.md). This section lists the
runtime-facing surface most BaseGrid screens use.

### Runtime Reads

```ts
runtime.activeRowFor(path); // RowCursor | null
runtime.selectedRowsFor(path); // RowSelection
runtime.selectedRowIds(path); // readonly RowId[]
runtime.rowSelectionContainsRow(path, rowId); // boolean
runtime.rowInteractionStatusFor(path, rowId);
// "idle" | "selected" | "cursor" | "cursor-selected"
```

### Subscriptions

```ts
runtime.subscribeActiveRow(path, callback);
runtime.subscribeSelectedRows(path, callback);
runtime.subscribeSelectedRowIds(path, callback);
runtime.subscribeRowSelectionContainsRow(path, rowId, callback);
runtime.subscribeRowInteractionStatus(path, rowId, callback);
```

### Commands

```ts
runtime.rowInteraction.setRowCursor({ path, rowId });
runtime.rowInteraction.clearRowCursor();
runtime.rowInteraction.selectRow(path, rowId);
runtime.rowInteraction.setRowSelection(path, selection);
runtime.rowInteraction.toggleRowSelection(path, rowId);
runtime.rowInteraction.extendRowSelectionTo(path, rowId);
runtime.rowInteraction.extendRowSelectionToCursor({ path, rowId });
runtime.rowInteraction.clearRowSelection(path);
```

### Presets

```ts
CELL_EDITING_GRID;
CELL_EDITING_NO_SELECTION_GRID;
CELL_GRID_WITH_ACTIVE_ROW;
CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION;
CELL_PRIMARY_WITH_SIDE_PANEL_ROW;
CELL_PRIMARY_WITH_SELECTED_SIDE_PANEL_ROW;
ROW_PRIMARY_MASTER_DETAIL;
ROW_MULTISELECT_LIST;
```

Pass a preset to `createGridRuntime`.

```ts
const runtime = createGridRuntime({
  schema,
  dataSource,
  interaction: ROW_MULTISELECT_LIST,
});
```

## Expansion API

Expansion lives on `runtime.coordinator`.

```ts
runtime.coordinator.toggleExpand(path, rowId);
```

Expansion resolves child data sources before it updates the expansion set.
`runtime.materializedChildren(path, rowId)` returns registered child paths in
schema order.

```ts
const projectPath = rootPath("projects");
const projectRowId = makeRowId(projectPath, "project-1");

runtime.coordinator.toggleExpand(projectPath, projectRowId);

const childPaths = runtime.materializedChildren(projectPath, projectRowId);
```

## Phantoms API

Phantoms are author-state rows layered into displayed rows. They are not stored
inside a data source until committed.

```ts
const runtime = createGridRuntime({
  schema,
  dataSource,
  initialPhantomsByPath: new Map([
    [
      rootPath("projects"),
      [{ rowKey: "draft-1", columns: { name: "New project" } }],
    ],
  ]),
});

runtime.commitPhantom(rootPath("projects"), "draft-1");
```

`commitPhantom` inserts the phantom through the source's `insertNode`, removes
the phantom from the phantom channel, and emits `phantomCommitted`. It throws if
the source is readonly or the phantom does not exist.

## Styling and DOM Contract

BaseGrid renders stable data attributes for host styling.

Common attributes:

- `data-grid-part="root"` on a level root
- `data-grid-part="body"` on a level body
- `data-grid-path` on a level root
- `data-grid-depth` on a level root
- `data-active="true" | "false"` on a level root
- `data-row-interaction-status` on row elements
- `data-row-selectable` on row elements

Example:

```css
[data-grid-part="root"][data-active="false"] {
  opacity: 0.72;
}

[data-row-interaction-status="cursor"],
[data-row-interaction-status="cursor-selected"] {
  outline: 1px solid var(--accent);
}
```

ColumnPreset width helpers are useful when writing custom headers or toolbars:

```tsx
import { templateColumns } from "@sapporta/ui";

function CustomHeader({ schema }: { schema: ColumnSchema[] }) {
  return (
    <div
      data-grid-part="header"
      style={{
        display: "grid",
        gridTemplateColumns: templateColumns(schema),
      }}
    >
      {schema.map((column) => (
        <div key={column.id}>{column.name}</div>
      ))}
    </div>
  );
}
```

## Construction Checklist

For a new BaseGrid, build in this order:

1. Define your `TreeNode` shape and stable row keys.
2. Create `ColumnSchema[]`, preferably with ColumnPreset helpers first.
3. Create a `GridSchema` with root and child levels.
4. Start with `inMemoryGridDataSource` or implement `GridDataSource`.
5. Create the runtime with `createGridRuntime`.
6. Render `<GridRuntimeProvider>` and `<GridLevel path={rootPath(...)} />`.
7. Add runtime event handlers for saves, reconciliation, and status changes.
8. Add interaction config, row selection columns, and host UI.
9. Move to a custom data source when persistence or server-managed query state
   is needed.
