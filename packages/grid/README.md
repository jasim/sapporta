# @sapporta/grid

`@sapporta/grid` provides the Sapporta grid runtime, React grid components,
column presets, and lookup cache primitives. The package uses `@sapporta/ui`
for generic UI primitives. Application routes and server contracts remain in
the host application.

## Runtime

`GridRuntime` contains grid-wide schema, interaction, events, registered
levels, and row operations. `GridLevelRuntime` binds rows, subscriptions,
interaction, expansion, writes, and drafts to one `GridPath`.

Every `TreeNode` carries a required `rowKey`. Sapporta uses that key across
sorting, filtering, insertion, and removal. `makeRowId` creates a tagged data
row identity from a level path and row key.

```ts
import {
  childPath,
  createGridRuntime,
  inMemoryGridDataSource,
  makeRowId,
  type GridSchema,
  type TreeNode,
} from "@sapporta/grid";

const schema = {
  rootLevel: "orders",
  levels: {
    orders: {
      name: "orders",
      rowHeaderColumn: "none",
      columns: [
        {
          id: "status",
          name: "Status",
          renderCell: ({ value }) => String(value ?? ""),
        },
      ],
      options: {},
      childLevels: ["lines"],
    },
    lines: {
      name: "lines",
      rowHeaderColumn: "none",
      columns: [
        {
          id: "quantity",
          name: "Quantity",
          renderCell: ({ value }) => String(value ?? ""),
        },
      ],
      options: {},
      childLevels: [],
    },
  },
} satisfies GridSchema;

const tree = [
  {
    rowKey: "order-42",
    levelName: "orders",
    columns: { status: "open" },
    children: {
      lines: [
        {
          rowKey: "line-1",
          levelName: "lines",
          columns: { quantity: 1 },
        },
      ],
    },
  },
] satisfies TreeNode[];

const localLevel = {
  sortMode: "none",
  filterMode: "none",
  paginationMode: "none",
} as const;

const runtime = createGridRuntime({
  schema,
  dataSource: inMemoryGridDataSource({
    schema,
    tree,
    levels: { orders: localLevel, lines: localLevel },
  }),
});

const root = runtime.root;
const orderId = makeRowId(root.path, "order-42");
root.expand(orderId);

const lines = runtime.level(childPath(root.path, "order-42", "lines"));
const lineId = makeRowId(lines.path, "line-1");
lines.writeCell({ rowId: lineId, colId: "quantity" }, 2);
```

`runtime.registeredLevels()` returns every registered level, including retained
collapsed levels. `runtime.subscribeLevels()` reports changes to that set.

## State and events

The runtime exposes identity-stable snapshots with matching invalidation
subscriptions. `runtime.activeRow()` returns the current grid-wide active row.
`runtime.subscribeActiveRow()` observes row identity, disappearance, and
displayed-value changes.

`useGridActiveRow(runtime)` adapts that state for a component that owns the
provider. Provider descendants can call `useGridActiveRow()` without an
argument.

```tsx
import {
  GridLevel,
  GridRuntimeProvider,
  rootPath,
  useGridActiveRow,
  type GridRuntime,
} from "@sapporta/grid";

function OrdersGrid({ runtime }: { runtime: GridRuntime }) {
  const activeRow = useGridActiveRow(runtime);

  return (
    <section>
      <GridRuntimeProvider runtime={runtime}>
        <GridLevel path={rootPath(runtime.schema.rootLevel)} />
      </GridRuntimeProvider>
      <output>{String(activeRow?.row.columns.status ?? "")}</output>
    </section>
  );
}
```

`RuntimeArgs.on` installs listeners before root-source acquisition.
`runtime.on(event, listener)` installs listeners during the runtime lifetime.
Events report discrete commands, outcomes, and defined transitions.
`rowActivated` reports every successful configured row activation. Stored cell
and row selection events remain separate from derived selection snapshots.

## Advanced composition

`@sapporta/grid/advanced` provides cursor and controller helpers for custom
grid renderers and interaction layers.

```ts
import { controllerFor, cursorManagerFor } from "@sapporta/grid/advanced";

const cursors = cursorManagerFor(runtime);
cursors.moveCellCursorTo({
  path: lines.path,
  rowId: lineId,
  colId: "quantity",
});

const controller = controllerFor(runtime, lines.path);
controller.startEdit({ rowId: lineId, colId: "quantity" }, "f2");
controller.cancelEdit();

runtime.dispose();
```
