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

## Tree levels

A tree level shows rows of one level that refer to each other, such as
accounts with a `parent_id` column. All rows share one header and one set of
columns. The hierarchy is shown only in the tree column: each row is indented
by its depth, and a row with children has a chevron that expands or collapses
it. This is different from `childLevels`, where an expanded row opens a nested
grid of another level with its own header.

A level becomes a tree level when it declares `tree`. `parentKeyField` names
the field of `TreeNode.columns` that holds the parent's row key. A `null`,
`undefined`, or `""` value marks a top-level row. `withTreeColumn` makes a
column the tree column: it adds the indentation and the chevron.

```ts
import { withTreeColumn, type GridSchema } from "@sapporta/grid";

const schema = {
  rootLevel: "accounts",
  levels: {
    accounts: {
      name: "accounts",
      rowHeaderColumn: "none",
      columns: [
        withTreeColumn({
          id: "name",
          name: "Account",
          renderCell: ({ value }) => String(value ?? ""),
        }),
      ],
      options: {},
      childLevels: [],
      tree: { parentKeyField: "parent_id" },
    },
  },
} satisfies GridSchema;
```

The source still delivers a flat list, already sorted and filtered. The grid
builds the tree from that list, so a sort orders the siblings at every depth.
Rows start expanded unless `tree.defaultExpanded` is `false`. A row whose
parent is not in the list is shown at top level, and a parent loop is cut and
reported through `onObserverError`.

`level.tree` expands and collapses rows, reads parents and children, and adds
a draft child under a row with `addChild`. The draft's parent-key field is
filled in, so committing the draft creates the row under that parent.
Collapsing a row moves the cursor out of the hidden rows, and hidden rows
leave the row selection. The `treeExpansionChanged` event reports each
expansion change.

`addChild` fills the parent-key field with the parent's row key, which is a
string. When the field holds a typed key, such as a number, set
`tree.parentKeyValue` to read that value from the parent row:

```ts
tree: {
  parentKeyField: "parent_id",
  parentKeyValue: (parent) => parent.columns.id,
},
```

A tree level declares no `childLevels`. Call `validateLevelTree` to check a
level's tree declaration before you create a runtime.

In a row list with `activeRow.keyboard.expansion: "enabled"`, Right expands a
row or moves to its first child, Left collapses a row or moves to its parent,
and Space toggles. In a cell grid, Space on the tree column toggles.

A filtered tree must stay connected. The in-memory source keeps each match's
ancestors, and by default each match's descendants
(`treeMatchContext: "ancestors"` keeps only the ancestors). A custom source
lists ancestors that do not match themselves in
`LevelSnapshot.treeContextRowKeys`. Those rows are marked with
`data-tree-context` and `row.tree.context`, so they can be styled as context.

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
controller.startEdit({ rowId: lineId, colId: "quantity" }, "enter");
controller.cancelEdit();

runtime.dispose();
```
