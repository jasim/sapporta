# TGrid Usage Guide

TGrid is a React grid made specifically for tables defined using Sapporta. It lets you render your tables as editable grids,
with sorting, filtering, exporting, and support for nested tables. The default table grids rendered by Sapporta uses 
the same abstraction.

## TGrid is for your domain-specific grids

Use `TGrid` when you want a grid for Sapporta tables, but the
generated `TableRoute` is not specific enough. `TableRoute` pages 
are intentionally generic. They are useful for  CRUD, but product workflows often need more:

- A root table with expandable child rows.
- Different column layouts for the same table in different contexts.
- Computed or action columns that are not database fields.
- Editors that call domain APIs instead of blindly writing one field.
- Toolbar state that can sync to the URL.
- Runtime access to loaded rows, selected query state, export URLs, and custom
  app services.

TGrid keeps the table API as the default data source while exposing a typed,
level-first customization layer for application code.

Example: invoice screens with line items, order screens with fulfilment events,
grids where rows need external API validation, computed columns, and so on.

## Data comes from your database tables, defined in Sapporta schema

TGrid uses the standard Sapporta table APIs (`/api/tables`), which are based on the
table definitions in the `schema/` directory.

These APIs are the backend contract for table management: list, create, read,
update, delete, nested child access, lookup data, and CSV export. TGrid uses
them as its data source.

## TGrids compose ColumnPreset

TGrid columns are built from `ColumnPreset`. It turns a semantic column
kind such as text, number, select, lookup, foreign keys etc. into
grid column behavior. It defines the CellRenderer, CellEditor, formatting, comparison, 
header chrome, and visual properties. 

TGrid automatically computes the presets from the table schema. But its power comes
from its composability - you can pick just the columns you want, or override or create new virtual columns. 
You can also customize data save behaviour. 

```tsx
type InvoiceRow = {
  id: string;
  customer_id: string;
  invoice_date: string;
  due_date: string | null;
  status: "draft" | "sent" | "paid";
};

type RowsByLevel = {
  invoices: InvoiceRow;
};

const invoicesGrid = bindTGridTypes<RowsByLevel>();

function PaymentStatusCell() {
  const cell = invoicesGrid.useCell("invoices");
  return <span>{cell.row.status}</span>;
}

function OverdueDaysCell() {
  const cell = invoicesGrid.useCell("invoices");
  return <span>{cell.row.due_date ?? ""}</span>;
}

const invoiceColumns = invoicesGrid.columns("invoices", (columns) => [
  columns.table("customer_id", { header: "Customer" }),
  columns.table("invoice_date", { header: "Date", editable: false }),
  columns.table("status", {
    header: "Payment",
    renderCell: PaymentStatusCell,
    readsRowFields: ["status"],
    invalidatedBy: ["status"],
  }),
  columns.client("overdue_days", {
    header: "Overdue",
    width: 96,
    readsRowFields: ["due_date", "status"],
    invalidatedBy: ["due_date", "status"],
    renderCell: OverdueDaysCell,
  }),
  columns.remainingTable({ exclude: ["id", "customer_id"] }),
]);
```

Underneath both is `BaseGrid`, the table-agnostic Sapporta grid runtime. The base-grid is a headless
grid. It owns the mechanics of the grid: layout, focus, selection, editing lifecycle, nested rows,
data-source coordination, row identity, and command execution. It does not know anything about
how the cells are rendered, nor does it know about tables or APIs or filters etc.
Reach for `BaseGrid` only when you need a grid that is not a Sapporta table grid, or you want a customizability
beyond what is available in TGrid.

## TGrid: whirlwind tour

A TGrid feature usually has four parts:

1. Define the row type for each visible grid level.
2. Bind those row types with `bindTGridTypes`.
3. Declare `rootLevel` and a `levels` map with table metadata, parent links,
   query behavior, and columns.
4. Create a session and render `<TGrid runtime={session.runtime} />` with the
   session context.


```tsx
type InvoiceRow = {
  id: string;
  customer_id: string;
  invoice_date: string;
  due_date: string | null;
  status: "draft" | "sent" | "paid";
};

type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  item_id: string | null;
  quantity: number;
  balance_stock: number | null;
  stock_hold_expires_at: string | null;
};

type RowsByLevel = {
  invoices: InvoiceRow;
  "invoices.items": InvoiceItemRow;
};

type AppServices = {
  stockAvailable(input: {
    lineId: string;
    itemId: string | null;
    quantity: number;
  }): Promise<{
    available: boolean;
    balanceStock: number;
    holdExpiresAt: string | null;
  }>;
};

const invoicesGrid = bindTGridTypes<RowsByLevel, AppServices>();

async function saveQuantity(
  ctx: TGridCellWriteContext<
    RowsByLevel,
    AppServices,
    "invoices.items",
    "quantity"
  >,
) {
  const availability = await ctx.appServices.stockAvailable({
    lineId: ctx.row.id,
    itemId: ctx.row.item_id,
    quantity: ctx.value,
  });

  if (!availability.available) {
    return {
      kind: "patch",
      patch: {
        quantity: ctx.row.quantity,
        balance_stock: availability.balanceStock,
        stock_hold_expires_at: null,
      },
    };
  }

  return {
    kind: "patch",
    patch: {
      quantity: ctx.value,
      balance_stock: availability.balanceStock,
      stock_hold_expires_at: availability.holdExpiresAt,
    },
  };
}

function StockHoldCell() {
  const cell = invoicesGrid.useCell("invoices.items");
  return <StockHoldTimer expiresAt={cell.row.stock_hold_expires_at} />;
}

export function InvoiceGridView() {
  const appServices = useMemo<AppServices>(
    () => ({ stockAvailable }),
    [],
  );

  const session = invoicesGrid.useSession({
    rootLevel: "invoices",
    appServices,
    levels: {
      invoices: invoicesGrid.level("invoices", {
        table: invoicesTable,
        childLevels: ["invoices.items"],
        query: {
          owner: "host",
          pageSize: 50,
          initialSort: [{ colId: "invoice_date", direction: "desc" }],
          urlSync: true,
        },
        columns: (columns) => [
          columns.table("customer_id", { header: "Customer" }),
          columns.table("invoice_date", { header: "Date" }),
          columns.table("status", { header: "Status" }),
          columns.remainingTable({ exclude: ["id"] }),
        ],
      }),

      "invoices.items": invoicesGrid.level("invoices.items", {
        table: invoiceItemsTable,
        parent: {
          level: "invoices",
          foreignKey: "invoice_id",
          defaultSort: "item_id",
        },
        childLevels: [],
        query: { owner: "source", pageSize: 25 },
        columns: (columns) => [
          columns.table("item_id", {
            header: "Item",
          }),
          columns.table("quantity", {
            header: "Qty",
            saveCellValue: saveQuantity,
          }),
          columns.table("balance_stock", {
            header: "Stock",
            editable: false,
          }),
          columns.client("stock_hold", {
            header: "Hold",
            width: 120,
            readsRowFields: ["stock_hold_expires_at"],
            invalidatedBy: ["stock_hold_expires_at"],
            renderCell: StockHoldCell,
          }),
        ],
      }),
    },
  });

  const query = invoicesGrid.useQueryState({
    session,
    level: "invoices",
  });
  const totalCount = session.rootSource.snapshot().pagination?.totalCount ?? 0;
  const pages =
    totalCount > 0 ? Math.max(1, Math.ceil(totalCount / query.pageSize)) : 0;

  return (
    <>
      <TableToolbar
        tableLabel="Invoices"
        totalCount={totalCount}
        columns={invoicesTable.columns}
        filters={query.filters}
        search={query.search}
        searchable={(invoicesTable.search?.columns.length ?? 0) > 0}
        exportUrl={session.csvExportUrl("invoices")}
        hasSort={query.sort.length > 0}
        onAddFilter={query.addFilter}
        onUpdateFilter={query.updateFilter}
        onRemoveFilter={query.removeFilter}
        onSearchChange={query.setSearch}
        onClearSort={query.clearSort}
      />

      <TGrid runtime={session.runtime} sessionContext={session} />

      <Pagination
        page={query.page}
        pages={pages}
        onPageChange={query.setPage}
        hrefForPage={(page) => session.tablePageUrl(page)}
      />
    </>
  );
}
```


## Core concepts

### Levels

A level is one rendered row collection in the grid. Root rows and child rows use
the same declaration shape.

```ts
const levels = {
  orders: ordersGrid.level("orders", {
    table: ordersTable,
    childLevels: ["orders.items"],
  }),
  "orders.items": ordersGrid.level("orders.items", {
    table: orderItemsTable,
    parent: { level: "orders", foreignKey: "order_id" },
    childLevels: [],
  }),
};
```

Level ids are semantic grid ids, not just table names. Prefer path-like ids such
as `orders.items` or `sales_invoices.items.allocations`. This lets the same
table appear in multiple places with different columns and behavior.

```ts
const ledgerGrid = bindTGridTypes<{
  ledger_entries: LedgerEntryRow;
  "ledger_entries.debit_allocations": AllocationRow;
  "ledger_entries.credit_allocations": AllocationRow;
}>();
```

### Row types

`RowsByLevel` maps each level id to the row shape for that level. TGrid uses the
map to type-check table column names, renderers, editors, and custom save
handlers.

```ts
type RowsByLevel = {
  orders: OrderRow;
  "orders.items": OrderItemRow;
};

const ordersGrid = bindTGridTypes<RowsByLevel>();
```

If you try to use a root-only field in a child level, TypeScript reports it:

```ts
ordersGrid.columns("orders.items", (columns) => [
  columns.table("quantity"),
  // columns.table("customer_id"), // error: not an OrderItemRow field
]);
```

### Sessions

A session is the live grid instance. It owns the runtime, query stores, lookup
registry, column mapper, row helpers, and export helpers for one level graph.

Use `grid.useSession(...)` inside React components. Use `grid.createSession(...)`
or `createTGridSession(...)` when you need to construct a session outside a
component and manage `dispose()` yourself.

```tsx
const session = ordersGrid.useSession({
  rootLevel: "orders",
  levels,
  appServices,
});

return <TGrid runtime={session.runtime} sessionContext={session} />;
```

## Declaring levels

Each `TGridLevelConfig` describes one level.

```ts
ordersGrid.level("orders.items", {
  table: orderItemsTable,
  parent: {
    level: "orders",
    foreignKey: "order_id",
    defaultSort: "line_no",
  },
  childLevels: ["orders.items.allocations"],
  query: {
    owner: "source",
    pageSize: 25,
    initialSearch: null,
  },
  columns: buildOrderItemColumns,
  rowsClient: customOrderItemsRowsClient,
});
```

Key fields:

- `table`: the Sapporta `TableSchema` for this level.
- `childLevels`: level ids that can be expanded under rows from this level.
- `parent`: required for non-root table-backed child levels.
- `query`: sorting, filtering, search, pagination, and ownership defaults.
- `columns`: ordered table/client column specs for this level.
- `rowsClient`: optional replacement for the default table rows client.

## Query state and toolbars

TGrid supports host-owned and source-owned query state.

Use `owner: "host"` when application UI needs direct control over a level's
sort, filter, search, or page state. Root levels default to host ownership.

```ts
query: {
  owner: "host",
  pageSize: 50,
  initialSort: [{ colId: "invoice_date", direction: "desc" }],
  urlSync: true,
}
```

Read host-owned query state with `useQueryState` on the binding or
`useTGridQueryState` as a standalone hook.

```ts
const query = invoicesGrid.useQueryState({
  session,
  level: "invoices",
});

query.setSearch("acme");
query.addFilter({ column: "status", op: "eq", value: "draft" });
```

Use `owner: "source"` for expanded child levels that should use fixed defaults
per expanded parent row.

```ts
query: {
  owner: "source",
  pageSize: 20,
  initialSort: [{ colId: "line_no", direction: "asc" }],
}
```

`useQueryState` only works for host-owned levels. For source-owned levels,
configure defaults through `query` and let the grid source manage each expanded
path.

## Columns

The column builder is scoped to one level. It exposes three methods:

- `columns.table(name, options)`: add a real table column.
- `columns.client(id, options)`: add a browser-only column.
- `columns.remainingTable(options)`: append visible table columns not already
  listed.

```ts
function buildOrderItemColumns(
  columns: TGridColumnsBuilder<RowsByLevel, AppServices, "orders.items">,
) {
  return [
    columns.table("line_no", { header: "#", editable: false }),
    columns.table("item_id", { header: "Item" }),
    columns.table("quantity", { header: "Qty" }),
    columns.client("availability", {
      header: "Availability",
      width: 140,
      readsRowFields: ["item_id", "quantity"],
      invalidatedBy: ["item_id", "quantity"],
      renderCell: AvailabilityCell,
    }),
    columns.remainingTable({ exclude: ["id", "order_id"] }),
  ];
}
```

### Table columns

Table columns start from Sapporta table metadata: header labels, width, display
kind, lookup behavior, select options, default renderers, default editors, and
default table API writes. Options passed to `columns.table` override behavior for
that level only.

Common table column options:

- `header`: override the visible header.
- `width`, `minWidth`, `maxWidth`: tune layout.
- `editable`: disable or enable editing for this level.
- `editTriggers`: customize how editing starts.
- `renderCell`: use a custom renderer component.
- `editor`: use a custom editor component.
- `readsRowFields`: declare fields the renderer depends on.
- `invalidatedBy`: declare fields that should invalidate derived display.
- `saveCellValue`: route writes through a domain-specific save handler.

### Client columns

Client columns are not database fields. Use them for actions, computed display,
validation state, cached domain facts, request status, and workflow controls.

```ts
columns.client("approve", {
  header: "Approve",
  width: 96,
  renderCell: ApproveInvoiceCell,
});
```

Client columns are not included in default table create/update calls. If a
client column should affect persistent state, call a domain API from its renderer
or editor and then use session helpers such as `reloadRows` when needed.

### Remaining table columns

Use `remainingTable()` to keep a custom layout maintainable while still showing
schema-defined columns you did not list explicitly.

```ts
columns.remainingTable({
  exclude: ["id", "created_at", "updated_at"],
});
```

## Custom renderers and editors

Custom renderers and editors are normal React components. Inside the component,
use the binding hooks to recover typed context for the level.

```tsx
function AvailabilityCell() {
  const cell = ordersGrid.useCell("orders.items");

  return (
    <span>
      {cell.row.item_id}: {cell.row.quantity}
    </span>
  );
}
```

Editors use `useEditor(levelId, columnName)` to get typed `value`, `commit`, and
`cancel` APIs.

```tsx
function QuantityEditor() {
  const editor = ordersGrid.useEditor("orders.items", "quantity");

  return (
    <input
      type="number"
      value={editor.value}
      onChange={(event) => editor.commit(Number(event.target.value))}
      onBlur={() => editor.cancel()}
    />
  );
}
```

The cell context includes:

- `levelId`: the current level id.
- `path`: the materialized grid path for this cell.
- `value`: the current cell value.
- `row`: the typed row for the current level.
- `rowKey`: the row identity.
- `column`: table/grid column metadata.
- `runtime`: the underlying grid runtime.
- `appServices`: services supplied when the binding or session was created.

## Domain-specific writes

By default, editable table columns write through the Sapporta table row API. Use
`saveCellValue` when a cell edit must call domain logic, update multiple fields,
validate with external state, or return an authoritative row from an endpoint.

```ts
async function saveWarehouse(
  ctx: TGridCellWriteContext<
    RowsByLevel,
    AppServices,
    "orders.items",
    "warehouse_id"
  >,
) {
  const result = await ctx.appServices.inventoryApi.assignWarehouse({
    lineId: ctx.row.id,
    warehouseId: ctx.value,
    quantity: ctx.row.quantity,
  });

  return {
    kind: "patch",
    patch: {
      warehouse_id: result.warehouse_id,
      balance_stock: result.balance_stock,
    },
  };
}
```

A write handler returns one of four shapes:

- `{ kind: "value", value }`: replace only the edited cell value.
- `{ kind: "patch", patch }`: patch multiple fields on the current row.
- `{ kind: "row", row }`: replace the full row with an authoritative row.
- `{ kind: "reload" }`: refetch the current source.

Use `{ kind: "row" }` when the backend recalculates fields that may not be known
to the client. Use `{ kind: "patch" }` when the domain response is partial but
still authoritative for specific fields.

## App services

App services let TGrid renderers, editors, and write handlers use domain objects
without making Sapporta own those objects.

Provide services when binding types:

```ts
const ordersGrid = bindTGridTypes<RowsByLevel, AppServices>({ appServices });
```

Or provide them when creating the session:

```ts
const session = ordersGrid.useSession({
  rootLevel: "orders",
  levels,
  appServices,
});
```

Read them from cell or write context:

```ts
function RiskBadgeCell() {
  const cell = ordersGrid.useCell("orders");
  const risk = cell.appServices.riskCache.get(cell.row.customer_id);
  return <span>{risk.label}</span>;
}
```

## Working with loaded rows

The session exposes helpers for loaded grid state. These helpers operate on rows
already materialized by the runtime; they are not database-wide queries.

```ts
const visibleOrders = session.getVisibleRows("orders");
const loadedOrder = session.getLoadedRow("ord_123", "orders");
session.reloadRows("orders");
```

For child levels, pass the materialized `GridPath` when you need a specific
expanded parent row's source. Custom cells receive the current `path` in their
cell context.

```ts
function RefreshCurrentItemsButton() {
  const cell = ordersGrid.useCell("orders.items");

  return (
    <button
      type="button"
      onClick={() => cell.runtime.sourceFor(cell.path).refetch()}
    >
      Refresh items
    </button>
  );
}
```

Use backend endpoints or reports for whole-table computations, aggregate counts,
or workflows that require rows outside the loaded grid page.

## CSV export URLs

Use the session-level helper when rendering toolbar export links.

```ts
const exportUrl = session.csvExportUrl("orders");
```

Each runtime level also exposes `csvExportUrl()`.

```ts
const exportUrl = session.levels.orders.csvExportUrl();
```

For host-owned levels, export URLs include the current sort, filters, and search
state.

## Schema helpers

The binding includes helpers for small schema adaptations in custom views.

Use `defineTableSchema` when you have table metadata without a runtime name:

```ts
const archiveTable = ordersGrid.defineTableSchema("archived_orders", {
  label: "Archived orders",
  columns: archivedOrderColumns,
});
```

Use `applySchemaOverrides` to adjust labels or column metadata for one level
without mutating the shared table schema.

```ts
const reviewOrdersTable = ordersGrid.applySchemaOverrides(
  "orders",
  ordersTable,
  {
    label: "Orders awaiting review",
    columns: {
      status: { label: "Review status" },
    },
  },
);
```

## Custom row clients

Most TGrid levels can use Sapporta's default table row API. Override
`rowsClient` when a level should keep TGrid's table-aware mapping but route
reads or writes through custom transport.

```ts
const levels = {
  "orders.items": ordersGrid.level("orders.items", {
    table: orderItemsTable,
    parent: { level: "orders", foreignKey: "order_id" },
    childLevels: [],
    rowsClient: orderItemsRowsClient,
    columns: buildOrderItemColumns,
  }),
};
```

A `rowsClient` supplies `fetch`, `create`, `update`, and `remove` functions with
the same shape as Sapporta's table row helpers.

## Multi-level example

A three-level invoice view can model invoices, invoice items, and item
allocations with one consistent level API.

```ts
type SalesRowsByLevel = {
  sales_invoices: SalesInvoiceRow;
  "sales_invoices.items": SalesInvoiceItemRow;
  "sales_invoices.items.allocations": AllocationRow;
};

const salesGrid = bindTGridTypes<SalesRowsByLevel, SalesServices>();

const levels = {
  sales_invoices: salesGrid.level("sales_invoices", {
    table: salesInvoicesTable,
    childLevels: ["sales_invoices.items"],
    query: {
      owner: "host",
      pageSize: 50,
      initialSort: [{ colId: "invoice_date", direction: "desc" }],
      urlSync: true,
    },
    columns: (columns) => [
      columns.table("customer_id", { header: "Customer" }),
      columns.table("invoice_date", { header: "Date" }),
      columns.table("status", { header: "Status" }),
      columns.client("approval_actions", {
        header: "Actions",
        width: 120,
        renderCell: InvoiceActionsCell,
      }),
      columns.remainingTable({ exclude: ["id"] }),
    ],
  }),

  "sales_invoices.items": salesGrid.level("sales_invoices.items", {
    table: salesInvoiceItemsTable,
    parent: {
      level: "sales_invoices",
      foreignKey: "invoice_id",
      defaultSort: "line_no",
    },
    childLevels: ["sales_invoices.items.allocations"],
    query: { owner: "source", pageSize: 25 },
    columns: (columns) => [
      columns.table("line_no", { header: "#", editable: false }),
      columns.table("item_id", { header: "Item" }),
      columns.table("quantity", { header: "Qty" }),
      columns.table("balance_stock", { header: "Stock", editable: false }),
      columns.client("availability_check", {
        header: "Check",
        width: 96,
        renderCell: AvailabilityCheckCell,
      }),
    ],
  }),

  "sales_invoices.items.allocations": salesGrid.level(
    "sales_invoices.items.allocations",
    {
      table: allocationsTable,
      parent: {
        level: "sales_invoices.items",
        foreignKey: "line_id",
        defaultSort: "warehouse_id",
      },
      childLevels: [],
      query: { owner: "source", pageSize: 10 },
      columns: (columns) => [
        columns.table("warehouse_id", { header: "Warehouse" }),
        columns.table("allocated_quantity", { header: "Allocated" }),
        columns.table("status", { header: "Status" }),
      ],
    },
  ),
};
```

The root, child, and nested child levels all use the same `level` and `columns`
APIs. The root level is only special because it is the initial rendered level and
usually owns toolbar or URL-synchronized query state.

## Public API reference

### `bindTGridTypes<RowsByLevel, AppServices>(args?)`

Creates a typed front door for one TGrid feature.

```ts
const grid = bindTGridTypes<RowsByLevel, AppServices>({ appServices });
```

Returned methods:

- `grid.level(levelId, config)`: type-check a `TGridLevelConfig` for a level.
- `grid.columns(levelId, build)`: type-check a reusable column builder.
- `grid.createColumnsBuilder(levelId)`: create a level-scoped builder directly.
- `grid.defineTableSchema(name, input)`: create a named `TableSchema`.
- `grid.applySchemaOverrides(levelId, schema, overrides)`: create a level-specific
  schema variant.
- `grid.createSession(args)`: create a session outside React hooks.
- `grid.useSession(args)`: create and dispose a session inside React.
- `grid.useQueryState(args)`: subscribe to host-owned level query state.
- `grid.useCell(levelId)`: read typed cell context in a renderer.
- `grid.useEditor(levelId, column)`: read typed editor context in an editor.
- `grid.useCurrentSession()`: read the current session context in descendants of
  `<TGrid />`.

### `TGrid`

Renders a session runtime.

```tsx
<TGrid runtime={session.runtime} sessionContext={session} />
```

### `TGridLevelConfig`

The config object accepted by `grid.level`.

```ts
type TGridLevelConfig = {
  table: TableSchema;
  columns?: TGridColumnSpecBuilder | readonly TGridColumnSpec[];
  childLevels: readonly string[];
  parent?: {
    level: string;
    foreignKey: string;
    defaultSort?: string | readonly SortDescriptor[];
  };
  query?: TGridLevelQueryConfig;
  rowsClient?: TableRowsClient;
};
```

### `TGridLevelQueryConfig`

Controls default query state and ownership for one level.

```ts
type TGridLevelQueryConfig = {
  owner?: "host" | "source";
  pageSize?: number | (() => number);
  initialPage?: number;
  initialSort?: readonly SortDescriptor[];
  initialFilters?: readonly FilterCondition[];
  initialSearch?: string | null;
  urlSync?: boolean;
};
```

### `TGridSession`

The session returned by `createTGridSession`, `useTGridSession`,
`grid.createSession`, or `grid.useSession`.

Useful properties and methods:

- `rootLevel`: root level id.
- `rootTableName`: root table name.
- `runtime`: the grid runtime passed to `<TGrid />`.
- `levels`: runtime metadata per level.
- `appServices`: supplied domain services.
- `lookupRegistry`: table lookup registry used by FK display.
- `queryStore`: root host query store.
- `rootSource`: root runtime data source.
- `columnMapper`: table-to-grid column mapper.
- `levelInfoById`: level/table/parent metadata.
- `getVisibleRows(levelId?, path?)`: loaded visible rows for a path.
- `getLoadedRow(rowKey, levelId?, path?)`: one loaded row, if materialized.
- `getQueryState(levelId?)`: host-owned query state snapshot.
- `reloadRows(levelId?, path?)`: refetch loaded rows for a path.
- `csvExportUrl(levelId?)`: CSV URL for a level.
- `tablePageUrl(page, levelId?)`: table page URL for a host-owned level.
- `dispose()`: release runtime and lookup resources.

### Standalone exports

The binding methods are the most ergonomic API for app code. Standalone exports
are also available from `@sapporta/ui` when explicit generics are more
convenient:

- `createTGridSession`
- `useTGridSession`
- `useTGridQueryState`
- `useTGridCell`
- `useTGridCellEditor`
- `useCurrentTGridSession`
- `createTGridColumnsBuilder`
- `buildTGridRuntimeConfig`
- `Pagination`
- `visiblePaginationItems`
- `buildTableSearchParams`
- `parseTableSearchParams`

Use standalone runtime/compiler exports only when building your own wrapper or
integrating TGrid into a non-standard host. For ordinary product views, prefer
`bindTGridTypes` plus `grid.useSession`.

## Common use cases

### Custom table page with toolbar

Use a host-owned root query, read it with `useQueryState`, pass it to
`TableToolbar`, and render `TGrid` below the toolbar.

### Nested parent-child editing

Declare child levels with `parent.level` and `parent.foreignKey`. TGrid filters
child rows by the expanded parent row and backfills the parent FK on child
inserts.

### Reusing the same table in multiple contexts

Give each context its own level id and column builder. Keep customization by
level id, not table name.

### Domain-aware cell edits

Attach `saveCellValue` to the table column that needs domain behavior. Return a
value, patch, row, or reload instruction from the handler.

### Client-side workflow columns

Use `columns.client` for action buttons, transient status, cached external data,
and validation indicators that do not belong in the table schema.

### Loaded-row UI helpers

Use `session.getVisibleRows`, `session.getLoadedRow`, and `session.reloadRows`
for UI behavior that only depends on currently materialized rows. Use backend
endpoints or reports for database-wide behavior.

## Practical constraints

- Define `RowsByLevel` for good TypeScript ergonomics.
- Keep level ids stable; they are used by row typing, child relationships, and
  runtime context.
- Non-root levels need `parent` for default table-backed child loading.
- `useQueryState` requires `query.owner: "host"`.
- Client columns are not persisted by the default table API.
- Loaded-row helpers only see rows loaded into the grid runtime.
- Backend endpoints remain authoritative for business decisions and
  cross-row consistency.
