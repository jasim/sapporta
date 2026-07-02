# Building a Grid from Scratch with BaseGrid

BaseGrid is Sapporta's low-level grid runtime and React renderer. Use it when
you want grid mechanics without Sapporta table CRUD, TGrid sessions, or table
API wiring.

This guide builds a project planning grid from scratch. The app owns its own
data, persistence, query controls, and domain services. BaseGrid supplies the
grid runtime, row identity, nested rendering, keyboard navigation, editing,
selection, expansion, and the React components that render levels.

## What We Are Building

Imagine a project planning screen with:

- projects at the root level
- tasks under each project
- editable cells for title, status, estimate, and due date
- nested expand/collapse
- keyboard navigation
- row selection for bulk actions
- a detail panel that follows the active row
- persistence through your own API

That is a BaseGrid-shaped problem. You want grid behavior, but you do not want
Sapporta to decide how rows are fetched or saved.

## BaseGrid vs TGrid

BaseGrid is the foundation:

- `GridSchema` describes levels and columns.
- `GridDataSource` supplies rows for each level.
- `createGridRuntime` creates the live runtime.
- `GridRuntimeProvider` puts the runtime in React context.
- `GridLevel` renders one level and recursively mounts expanded child levels.
- ColumnPreset helpers create ordinary BaseGrid `ColumnSchema` values.

TGrid is a table-aware adapter on top of BaseGrid. It knows about Sapporta table
schemas, table row APIs, table query state, lookup loading, and CSV URLs. If you
are building against your own backend or local state model, start with BaseGrid.

## The Mental Model

A BaseGrid has four important pieces:

```tsx
import {
  GridLevel,
  GridRuntimeProvider,
  createGridRuntime,
  inMemoryGridDataSource,
  rootPath,
  useGridRuntimeEffect,
} from "@sapporta/grid";

export function ProjectGrid() {
  const runtime = useGridRuntimeEffect(
    () =>
      createGridRuntime({
        schema,
        dataSource,
      }),
    [dataSource],
  );

  if (!runtime) return null;

  return (
    <GridRuntimeProvider runtime={runtime}>
      <GridLevel path={rootPath(schema.rootLevel)} />
    </GridRuntimeProvider>
  );
}
```

The runtime is not a React component. It is a plain TypeScript object that owns
grid state and coordinates data sources. React components read it through
context.

The data source owns row data. The runtime never stores your row array. When a
cell changes, BaseGrid calls the source through a runtime write method, and the
source publishes a new snapshot.

## Build a Custom Grid Screen

Use built-in table and report components when they fit the screen. Reach for
BaseGrid when your screen owns its own row shape, loading behavior, hierarchy,
editing rules, side panels, or toolbar behavior.

A custom grid screen usually needs two pieces:

1. a live grid instance that prepares the schema, data source, and interaction
   behavior
2. a React view that renders that live grid

Create the live grid with `useGridRuntimeEffect`, wait until it returns a
runtime, then pass the runtime to `GridRuntimeProvider`. The dependency list is
the runtime replacement policy. The hook creates the runtime after commit,
returns `null` until the committed runtime matches the current dependencies,
and disposes the created runtime from effect cleanup.

Avoid creating the runtime during render and pairing it with a cleanup effect.
That can break in React development mode. React may replay effects while
keeping render-created values, so the visible grid can keep using a runtime
that has already been disposed. The usual symptom is a grid that appears
briefly, then clears with `GridRuntime has been disposed.`

## Your First Flat Grid

Start with a flat task grid. BaseGrid rows are `TreeNode` objects. A node has a
`levelName`, a `columns` object keyed by column id, and optional nested
`children`.

```tsx
import {
  GridLevel,
  GridRuntimeProvider,
  createGridRuntime,
  inMemoryGridDataSource,
  rootPath,
  useGridRuntimeEffect,
  type GridSchema,
  type TreeNode,
} from "@sapporta/grid";
import { columnPreset } from "@sapporta/grid/column-preset";

const taskColumns = [
  columnPreset.text({
    id: "title",
    name: "Task",
    edit: "default",
    width: "fill",
  }),
  columnPreset.select({
    id: "status",
    name: "Status",
    edit: "default",
    width: "enum",
    options: ["todo", "doing", "done"],
  }),
  columnPreset.number({ id: "estimate", name: "Estimate", edit: "default" }),
  columnPreset.date({ id: "dueDate", name: "Due", edit: "default" }),
];

const schema: GridSchema = {
  rootLevel: "tasks",
  levels: {
    tasks: {
      name: "tasks",
      columns: taskColumns,
      childLevels: [],
      options: {
        rowKey: (node) => String(node.columns.id),
      },
    },
  },
};

const tasks: TreeNode[] = [
  {
    levelName: "tasks",
    columns: {
      id: "task-1",
      title: "Write project brief",
      status: "doing",
      estimate: 4,
      dueDate: "2026-06-02",
    },
  },
  {
    levelName: "tasks",
    columns: {
      id: "task-2",
      title: "Review budget",
      status: "todo",
      estimate: 2,
      dueDate: "2026-06-04",
    },
  },
];

export function TaskGrid() {
  const runtime = useGridRuntimeEffect(
    () =>
      createGridRuntime({
        schema,
        dataSource: inMemoryGridDataSource({
          schema,
          tree: tasks,
          levels: {
            tasks: {
              sortMode: "client",
              filterMode: "none",
              paginationMode: "none",
            },
          },
        }),
      }),
    [],
  );

  if (!runtime) return null;

  return (
    <GridRuntimeProvider runtime={runtime}>
      <GridLevel path={rootPath(schema.rootLevel)} />
    </GridRuntimeProvider>
  );
}
```

This example uses `inMemoryGridDataSource` because it is the fastest way to get
a grid on screen. A production app can replace it with a custom `GridDataSource`
that calls your own API.

## ColumnPreset: The Practical Column API

BaseGrid renders `ColumnSchema` values. You can write raw column schemas, but
most app code should start with ColumnPreset helpers because they create normal
columns with sensible renderers, editors, parsers, comparators, and widths.

```ts
import {
  boolean,
  currency,
  date,
  identifier,
  number,
  percentage,
  select,
  text,
} from "@sapporta/grid/column-preset";

const columns = [
  identifier({ id: "id", name: "ID", width: "compact" }),
  text({ id: "title", name: "Title", edit: "default", width: "fill" }),
  select({
    id: "status",
    name: "Status",
    edit: "default",
    options: [
      { value: "todo", label: "To do" },
      { value: "doing", label: "Doing" },
      { value: "done", label: "Done" },
    ],
  }),
  number({ id: "estimate", name: "Estimate", edit: "default" }),
  percentage({ id: "completion", name: "Complete" }),
  currency({ id: "budget", name: "Budget" }),
  date({ id: "dueDate", name: "Due" }),
  boolean({ id: "blocked", name: "Blocked", edit: "default" }),
];
```

ColumnPreset is still BaseGrid. The helpers return `ColumnSchema` objects, so
you can mix preset columns with raw columns:

```tsx
import type { ColumnSchema } from "@sapporta/grid";
import { text } from "@sapporta/grid/column-preset";

const StatusBadge = ({ value }: { value: unknown }) => (
  <span data-status={String(value)}>{String(value)}</span>
);

const columns: ColumnSchema[] = [
  text({ id: "title", name: "Title", edit: "default" }),
  {
    id: "statusBadge",
    name: "Status",
    renderCell: ({ row }) => <StatusBadge value={row.columns.status} />,
  },
];
```

Use a raw `ColumnSchema` when you need a fully custom renderer/editor contract.
Use ColumnPreset when you want standard display/edit behavior with small
overrides.

## Raw Column Rendering

A raw column controls cell display through `renderCell`.

```tsx
import type { ColumnSchema } from "@sapporta/grid";

const titleWithFlagColumn: ColumnSchema = {
  id: "title",
  name: "Task",
  renderCell: ({ row }) => {
    const blocked = row.columns.blocked === true;
    return (
      <span>
        {blocked ? "Blocked: " : ""}
        {String(row.columns.title ?? "")}
      </span>
    );
  },
};
```

Renderers receive `value`, `row`, `column`, and `path`. They should render the
cell's content, not focus or selection chrome. BaseGrid owns focus and selection
styling outside your renderer.

## Editing Cells

Preset columns become editable when you pass `edit: "default"`.

```ts
const editableColumns = [
  text({ id: "title", name: "Task", edit: "default" }),
  number({ id: "estimate", name: "Estimate", edit: "default" }),
  date({ id: "dueDate", name: "Due", edit: "default" }),
];
```

When an edit commits, BaseGrid calls:

```ts
runtime.writeCell(path, { rowId, colId }, value);
```

The runtime finds the source for `path` and calls `setCell` on that source. The
source applies the change, emits a snapshot transition, and optionally reports a
reconciliation result.

You can observe committed writes at runtime construction:

```ts
const runtime = createGridRuntime({
  schema,
  dataSource,
  on: {
    mutationCommitted(event) {
      if (event.kind === "cell") {
        console.log("cell write", event.coord, event.newValue);
      }
    },
    cellReconciled({ path, event }) {
      if (event.kind === "rejected") {
        console.error("save rejected", path, event.reason);
      }
    },
  },
});
```

## A Custom Editor

A raw editor receives `CellEditorProps`. It decides when to commit or cancel.

```tsx
import { useState } from "react";
import type { CellEditorProps, ColumnSchema } from "@sapporta/grid";

function StatusEditor(props: CellEditorProps) {
  const [value, setValue] = useState(String(props.value ?? "todo"));

  return (
    <select
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => props.onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onCommit(value, "down");
        if (event.key === "Escape") props.onCancel();
      }}
    >
      <option value="todo">To do</option>
      <option value="doing">Doing</option>
      <option value="done">Done</option>
    </select>
  );
}

const statusColumn: ColumnSchema = {
  id: "status",
  name: "Status",
  renderCell: ({ value }) => String(value ?? ""),
  edit: {
    editor: StatusEditor,
    startsOn: ["enter", "f2", "type", "doubleClick"],
  },
};
```

While an editor is open, the grid's key handler lets the focused editor element
own keys such as Enter, Escape, and Tab. The editor calls `onCommit` or
`onCancel`.

## Nested Grids

Nested grids are modeled as levels. A project row can have task children, and a
task row can have subtask children.

```ts
import { rootPath, type GridSchema, type TreeNode } from "@sapporta/grid";

const schema: GridSchema = {
  rootLevel: "projects",
  levels: {
    projects: {
      name: "projects",
      columns: [
        text({ id: "name", name: "Project", edit: "default" }),
        select({ id: "status", name: "Status", options: ["active", "done"] }),
      ],
      childLevels: ["tasks"],
      options: { rowKey: (node) => String(node.columns.id) },
    },
    tasks: {
      name: "tasks",
      columns: taskColumns,
      childLevels: ["subtasks"],
      options: { rowKey: (node) => String(node.columns.id) },
    },
    subtasks: {
      name: "subtasks",
      columns: taskColumns,
      childLevels: [],
      options: { rowKey: (node) => String(node.columns.id) },
    },
  },
};

const tree: TreeNode[] = [
  {
    levelName: "projects",
    columns: { id: "project-1", name: "Website", status: "active" },
    children: {
      tasks: [
        {
          levelName: "tasks",
          columns: {
            id: "task-1",
            title: "Design grid",
            status: "doing",
            estimate: 8,
          },
          children: {
            subtasks: [
              {
                levelName: "subtasks",
                columns: {
                  id: "subtask-1",
                  title: "Choose columns",
                  status: "done",
                  estimate: 1,
                },
              },
            ],
          },
        },
      ],
    },
  },
];
```

Render still starts at the root. `GridLevel` recursively mounts children when
rows are expanded.

```tsx
<GridRuntimeProvider runtime={runtime}>
  <GridLevel path={rootPath("projects")} />
</GridRuntimeProvider>
```

The runtime resolves child sources lazily. When a row expands for the first
time, the runtime calls `dataSource.resolveChild(parentPath, parentRowKey,
childLevelName)` and caches the result.

## Expanding and Collapsing Rows

Expansion is part of the runtime's structural state. You can toggle it through
the coordinator.

```ts
import { makeRowId, rootPath } from "@sapporta/grid";

const path = rootPath("projects");
const rowId = makeRowId(path, "project-1");

runtime.coordinator.toggleExpand(path, rowId);
```

When expanding, BaseGrid resolves child sources before it updates expansion
state. That means the next render can immediately ask the runtime which child
paths were materialized.

## Row Selection and Bulk Actions

Selection is configured when the runtime is created. For a row-list with
multi-select behavior:

```ts
import {
  ROW_MULTISELECT_LIST,
  createGridRuntime,
} from "@sapporta/grid";
import {
  rowSelectionColumn,
  select,
  text,
} from "@sapporta/grid/column-preset";

const taskColumns = [
  rowSelectionColumn(),
  text({ id: "title", name: "Task", edit: "default" }),
  select({ id: "status", name: "Status", options: ["todo", "doing", "done"] }),
];

const runtime = createGridRuntime({
  schema,
  dataSource,
  interaction: ROW_MULTISELECT_LIST,
});
```

`rowSelectionColumn()` is a ColumnPreset helper. It returns a normal
`ColumnSchema` that reads selection from the runtime and calls row interaction
commands on click.

Read selected rows from the runtime:

```ts
import { rootPath } from "@sapporta/grid";

const path = rootPath("tasks");
const selectedRowIds = runtime.selectedRowIds(path);

function deleteSelected() {
  for (const rowId of selectedRowIds) {
    const row = runtime.displayedRowFor(path, rowId);
    if (row?.kind === "data") {
      runtime.removeRow(path, String(row.source.columns.id));
    }
  }
}
```

For the full interaction matrix, presets, and row-selection commands, read
[BASEGRID-INTERACTIONS.md](./BASEGRID-INTERACTIONS.md).

## Detail Panels and Active Rows

The active row is the row that owns keyboard focus. Depending on the interaction
config, it may come from the active cell or from a row cursor.

```tsx
import { rootPath, useActiveRow, useGridRuntime } from "@sapporta/grid";

function TaskDetailPanel() {
  const path = rootPath("tasks");
  const runtime = useGridRuntime();
  const cursor = useActiveRow(path);
  const row = cursor ? runtime.displayedRowFor(path, cursor.rowId) : undefined;

  if (!row) return <aside>No task selected</aside>;

  return (
    <aside>
      <h2>{String(row.columns.title ?? "")}</h2>
      <p>Status: {String(row.columns.status ?? "")}</p>
    </aside>
  );
}
```

Use `useSelectedRows(path)` or `useSelectedRowIds(path)` instead when the panel
should follow the effective row selection rather than keyboard focus.

For React components, prefer the exported selection hooks:

```tsx
import {
  rootPath,
  useActiveCellForPath,
  useSelectedRows,
  useCellSelection,
  useSelectedRowIds,
} from "@sapporta/grid";

function GridToolbar() {
  const path = rootPath("tasks");
  const activeCell = useActiveCellForPath(path);
  const cellSelection = useCellSelection(path);
  const selectedRows = useSelectedRows(path);
  const selectedRowIds = useSelectedRowIds(path);

  return (
    <div>
      <span>{activeCell?.colId ?? "No active cell"}</span>
      <span>
        {cellSelection
          ? `${cellSelection.anchor.colId} to ${cellSelection.head.colId}`
          : "No cell range"}
      </span>
      <span>{selectedRows?.kind ?? "No row selection"}</span>
      <span>{selectedRowIds.length} rows selected</span>
    </div>
  );
}
```

## Custom Data Sources

The in-memory source is useful for local grids and tests. A real app often owns
an API-backed source. A source publishes snapshots and implements write verbs.

The runtime expects a `GridDataSource`:

```ts
import type {
  GridDataSource,
  GridPath,
  LevelDataSource,
  RowKey,
} from "@sapporta/grid";

function projectDataSource(): GridDataSource {
  return {
    rootSource() {
      return createProjectLevelSource();
    },
    resolveChild(parentPath: GridPath, parentRowKey: RowKey, childLevelName) {
      if (childLevelName === "tasks") {
        return createTasksLevelSource(parentRowKey);
      }
      return createSubtasksLevelSource(parentRowKey);
    },
    dispose() {
      // Close subscriptions, abort requests, clear caches.
    },
  };
}
```

A writable level source owns its rows and notifies subscribers when the snapshot
changes:

```ts
import type {
  CellChange,
  LevelSnapshot,
  ReconcileEvent,
  TreeNode,
  WritableLevelDataSource,
} from "@sapporta/grid";

function createProjectLevelSource(): WritableLevelDataSource {
  let nodes: TreeNode[] = [];
  let snapshot: LevelSnapshot = {
    status: "loading",
    nodes,
    serverManaged: { sort: true, filter: true, pagination: true },
  };
  const subscribers = new Set<() => void>();
  const reconcileSubscribers = new Set<(event: ReconcileEvent) => void>();

  function publish(next: LevelSnapshot) {
    snapshot = next;
    for (const subscriber of subscribers) subscriber();
  }

  async function refetch() {
    publish({ ...snapshot, status: "loading" });
    try {
      nodes = await fetchProjectNodes();
      publish({
        status: "ready",
        nodes,
        serverManaged: { sort: true, filter: true, pagination: true },
      });
    } catch (error) {
      publish({
        status: "error",
        error: error instanceof Error ? error : new Error(String(error)),
        nodes,
        serverManaged: { sort: true, filter: true, pagination: true },
      });
    }
  }

  function setCell(rowKey: string, colId: string, value: unknown) {
    const prior = nodes;
    nodes = nodes.map((node) =>
      String(node.columns.id) === rowKey
        ? { ...node, columns: { ...node.columns, [colId]: value } }
        : node,
    );
    publish({ ...snapshot, status: "ready", nodes });

    void saveCell(rowKey, colId, value).catch((error) => {
      for (const subscriber of reconcileSubscribers) {
        subscriber({
          kind: "rejected",
          rowKey,
          colId,
          optimisticValue: value,
          priorValue: prior.find((n) => String(n.columns.id) === rowKey)
            ?.columns[colId],
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  return {
    writable: true,
    snapshot: () => snapshot,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    setSort(sort) {
      void fetchProjectsWith({ sort });
    },
    setFilter(filter) {
      void fetchProjectsWith({ filter });
    },
    setPage(page, pageSize) {
      void fetchProjectsWith({ page, pageSize });
    },
    refetch,
    setCell,
    applyChanges(changes: CellChange[]) {
      for (const change of changes) {
        setCell(change.rowKey, change.colId, change.value);
      }
    },
    insertNode(node, atIndex = nodes.length) {
      nodes = [...nodes.slice(0, atIndex), node, ...nodes.slice(atIndex)];
      publish({ ...snapshot, nodes });
    },
    removeNode(rowKey) {
      nodes = nodes.filter((node) => String(node.columns.id) !== rowKey);
      publish({ ...snapshot, nodes });
    },
    onReconcile(fn) {
      reconcileSubscribers.add(fn);
      return () => reconcileSubscribers.delete(fn);
    },
    dispose() {
      subscribers.clear();
      reconcileSubscribers.clear();
    },
  };
}
```

The example is intentionally minimal. A production source should preserve
snapshot identity on no-op reads, abort stale requests, and make server-managed
sort/filter/pagination explicit through `serverManaged`.

## Host Query Controls

BaseGrid does not define a toolbar or filter grammar. The source owns query
state and exposes generic commands:

```tsx
function TaskToolbar({ path }: { path: GridPath }) {
  const runtime = useGridRuntime();
  const snapshot = useLevelSnapshot(path);
  const source = runtime.sourceFor(path);

  return (
    <div>
      <button
        onClick={() => source.setSort([{ colId: "dueDate", direction: "asc" }])}
      >
        Sort by due date
      </button>
      <button onClick={() => source.refetch()}>Refresh</button>
      {snapshot.status === "loading" ? <span>Loading</span> : null}
    </div>
  );
}
```

Your filter type can be anything. BaseGrid carries it as `unknown` at the
cross-source boundary and only calls a compiled `RowPredicate` when local
filtering is enabled.

## Styling and Chrome

`GridLevel` accepts optional chrome callbacks for headers and level containers.

```tsx
<GridLevel
  path={rootPath("projects")}
  chrome={{
    renderLevelHeader: ({ levelName, schema }) => (
      <div data-grid-part="header">
        {levelName} ({schema.length} columns)
      </div>
    ),
    levelContainerClassName: ({ levelName }) => `grid-level-${levelName}`,
  }}
/>
```

BaseGrid also writes data attributes such as `data-grid-part`,
`data-grid-path`, `data-grid-depth`, and `data-active`. Row and cell components
write row/cell status attributes that you can target in CSS. For the row and
cell selection styling contract, read
[BASEGRID-STYLING.md](./BASEGRID-STYLING.md).

## Performance Rules

BaseGrid separates state into four channels:

- static: schema, columns, renderers, runtime context
- transient: per-path controller state such as focus, editing, and selection
- structural: runtime-wide expansion and global cursor state
- data: per-path data sources and snapshots

The practical guidance is simple:

- Create schemas and runtimes at stable boundaries; do not recreate them on
  every render.
- Keep source snapshots identity-stable when nothing changed.
- Put app data in the data source, not in React state that mirrors the source.
- Let custom renderers render content only; focus and selection chrome belongs
  to the grid.

## Complete Skeleton

This is the usual shape of a BaseGrid screen:

```tsx
import {
  CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  GridLevel,
  GridRuntimeProvider,
  createGridRuntime,
  inMemoryGridDataSource,
  rootPath,
  useGridRuntimeEffect,
  type GridSchema,
  type TreeNode,
} from "@sapporta/grid";
import {
  columnPreset,
  rowSelectionColumn,
} from "@sapporta/grid/column-preset";

const schema: GridSchema = {
  rootLevel: "projects",
  levels: {
    projects: {
      name: "projects",
      columns: [
        rowSelectionColumn(),
        columnPreset.text({
          id: "name",
          name: "Project",
          edit: "default",
          width: "fill",
        }),
        columnPreset.select({
          id: "status",
          name: "Status",
          edit: "default",
          options: ["active", "paused", "done"],
        }),
      ],
      childLevels: ["tasks"],
      options: { rowKey: (node) => String(node.columns.id) },
    },
    tasks: {
      name: "tasks",
      columns: [
        rowSelectionColumn(),
        columnPreset.text({
          id: "title",
          name: "Task",
          edit: "default",
          width: "fill",
        }),
        columnPreset.select({
          id: "status",
          name: "Status",
          edit: "default",
          options: ["todo", "doing", "done"],
        }),
      ],
      childLevels: [],
      options: { rowKey: (node) => String(node.columns.id) },
    },
  },
};

export function ProjectPlanner({ tree }: { tree: TreeNode[] }) {
  const runtime = useGridRuntimeEffect(
    () =>
      createGridRuntime({
        schema,
        dataSource: inMemoryGridDataSource({
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
        }),
        interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
      }),
    [tree],
  );

  if (!runtime) return null;

  return (
    <div className="project-planner">
      <GridRuntimeProvider runtime={runtime}>
        <GridLevel
          path={rootPath(schema.rootLevel)}
          chrome={columnPreset.chrome()}
        />
        <ProjectDetailPanel path={rootPath(schema.rootLevel)} />
      </GridRuntimeProvider>
    </div>
  );
}
```

For exact API signatures, read [BASEGRID-API.md](./BASEGRID-API.md). For
keyboard, cursor, row selection, and interaction presets, read
[BASEGRID-INTERACTIONS.md](./BASEGRID-INTERACTIONS.md).
