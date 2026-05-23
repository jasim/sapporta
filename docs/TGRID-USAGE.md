# TGrid Usage Guide

TGrid is Sapporta's typed table-grid adapter for custom React views. It lets an
application declare a level graph, column layout, custom renderers, custom save
handlers, query controls, and app services while still using the standard table
row APIs by default.

Use the generated `TableRoute` for generic CRUD screens. Use TGrid when a
workflow needs a custom table experience: nested rows, computed columns,
workflow-specific editors, a custom toolbar, or save behavior that has to call
application services.

## The Shape

A TGrid has four public pieces:

- `defineTGrid({ rootLevel, levels })` creates a pure definition.
- `createTGridSession(definition, args)` creates a disposable live session
  outside React.
- `useTGridSession(definition, args)` creates and disposes a live session inside
  React.
- `<TGrid session={session} />` renders the session.

The definition is the blueprint. The session owns live resources: query stores,
lookup caches, compiled columns, the grid runtime, endpoint wiring, and export
helpers. The React component only mounts a session into the grid UI.

## Minimal Example

```tsx
import {
  TGrid,
  createColumnsBuilder,
  defineTGrid,
  useTGridCell,
  useTGridSession,
} from "@sapporta/ui";

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

function PaymentStatusCell() {
  const cell = useTGridCell<RowsByLevel, unknown, "invoices">("invoices");
  return <span>{cell.row.status}</span>;
}

const invoiceColumns = createColumnsBuilder<RowsByLevel, unknown, "invoices">(
  "invoices",
);

const invoicesGrid = defineTGrid<RowsByLevel>({
  rootLevel: "invoices",
  levels: {
    invoices: {
      table: invoicesTable,
      childLevels: [],
      query: { owner: "host", pageSize: 50, urlSync: true },
      columns: [
        invoiceColumns.table("customer_id", { header: "Customer" }),
        invoiceColumns.table("invoice_date", {
          header: "Date",
          editable: false,
        }),
        invoiceColumns.table("status", {
          header: "Payment",
          renderCell: PaymentStatusCell,
          readsRowFields: ["status"],
          invalidatedBy: ["status"],
        }),
        invoiceColumns.remainingTable({ exclude: ["id", "customer_id"] }),
      ],
    },
  },
});

export function InvoiceGridView() {
  const session = useTGridSession(invoicesGrid, {
    hostQuerySeeds: {
      invoices: {
        sort: [{ colId: "invoice_date", direction: "desc" }],
      },
    },
  });

  if (!session) return <Spinner />;

  return <TGrid session={session} />;
}
```

`invoicesTable` is a normal Sapporta `TableSchema`. Every table used as a level
must have a primary key column, and every row returned by the data source must
include a non-null value for that primary key.

## Multi-Level Example

This example shows the pattern for a full custom page: create the session in one
component, then pass the non-null session to an inner component that uses hooks
such as `useTGridQueryState`. This keeps React hook order stable while the
session is being created.

```tsx
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  Pagination,
  TGrid,
  TableToolbar,
  createColumnsBuilder,
  defineTGrid,
  startTGridLookupLoading,
  useTGridCell,
  useTGridQueryState,
  useTGridSession,
  type TGridCellWriteContext,
  type TGridSession,
} from "@sapporta/ui";

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

  return {
    kind: "patch" as const,
    patch: {
      quantity: availability.available ? ctx.value : ctx.row.quantity,
      balance_stock: availability.balanceStock,
      stock_hold_expires_at: availability.available
        ? availability.holdExpiresAt
        : null,
    },
  };
}

function StockHoldCell() {
  const cell = useTGridCell<RowsByLevel, AppServices, "invoices.items">(
    "invoices.items",
  );
  return <StockHoldTimer expiresAt={cell.row.stock_hold_expires_at} />;
}

const itemColumns = createColumnsBuilder<
  RowsByLevel,
  AppServices,
  "invoices.items"
>("invoices.items");

const invoicesGrid = defineTGrid<RowsByLevel, AppServices>({
  rootLevel: "invoices",
  levels: {
    invoices: {
      table: invoicesTable,
      childLevels: ["invoices.items"],
      query: { owner: "host", pageSize: 50, urlSync: true },
      columns: (columns) => [
        columns.table("customer_id", { header: "Customer" }),
        columns.table("invoice_date", { header: "Date" }),
        columns.table("status", { header: "Status" }),
        columns.remainingTable({ exclude: ["id"] }),
      ],
    },
    "invoices.items": {
      table: invoiceItemsTable,
      parent: {
        level: "invoices",
        foreignKey: "invoice_id",
        defaultSort: "item_id",
      },
      childLevels: [],
      query: { owner: "source", pageSize: 25 },
      columns: [
        itemColumns.table("item_id", { header: "Item" }),
        itemColumns.table("quantity", {
          header: "Qty",
          saveCellValue: saveQuantity,
        }),
        itemColumns.table("balance_stock", {
          header: "Stock",
          editable: false,
        }),
        itemColumns.client("stock_hold", {
          header: "Hold",
          width: 120,
          readsRowFields: ["stock_hold_expires_at"],
          invalidatedBy: ["stock_hold_expires_at"],
          renderCell: StockHoldCell,
        }),
      ],
    },
  },
});

export function InvoiceGridView() {
  const services = useMemo<AppServices>(() => ({ stockAvailable }), []);
  const session = useTGridSession(invoicesGrid, {
    services,
    onQueryUrlChange: (state) => {
      updateInvoiceUrl(state);
    },
    hostQuerySeeds: {
      invoices: {
        sort: [{ colId: "invoice_date", direction: "desc" }],
      },
    },
  });

  useEffect(() => {
    if (!session) return;
    return startTGridLookupLoading(session);
  }, [session]);

  if (!session) return <Spinner />;

  return <InvoiceGridInner session={session} />;
}

function InvoiceGridInner({
  session,
}: {
  session: TGridSession<RowsByLevel, AppServices>;
}) {
  const query = useTGridQueryState({
    session,
    level: "invoices",
  });
  const totalCount = useSourceField(
    session,
    (snapshot) => snapshot.pagination?.totalCount ?? 0,
  );
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

      <TGrid session={session} />

      <Pagination
        page={query.page}
        pages={pages}
        onPageChange={query.setPage}
        hrefForPage={(page) => session.tablePageUrl(page)}
      />
    </>
  );
}

function useSourceField<T>(
  session: TGridSession<RowsByLevel, AppServices>,
  pick: (
    snapshot: ReturnType<
      TGridSession<RowsByLevel, AppServices>["rootSource"]["snapshot"]
    >,
  ) => T,
): T {
  return useSyncExternalStore(
    (callback) => session.rootSource.subscribe(callback),
    () => pick(session.rootSource.snapshot()),
  );
}
```

`startTGridLookupLoading(session)` is needed when the grid displays foreign-key
columns. It subscribes to loaded rows and fills FK value caches so cells can show
labels instead of raw ids. Clean it up with the effect teardown.

## Definitions and Levels

`defineTGrid` returns the same object after validating the graph. It checks that
the root level exists, non-root levels have parents, child level ids exist, and
each level table has a primary key.

```ts
const ordersGrid = defineTGrid<RowsByLevel, Services>({
  rootLevel: "orders",
  levels: {
    orders: {
      table: ordersTable,
      childLevels: ["orders.items"],
      query: { owner: "host", pageSize: 50, urlSync: true },
    },
    "orders.items": {
      table: orderItemsTable,
      parent: {
        level: "orders",
        foreignKey: "order_id",
        defaultSort: "line_no",
      },
      childLevels: [],
      query: { owner: "source", pageSize: 25 },
    },
  },
});
```

A level is one rendered row collection. Level ids are semantic grid ids, not
necessarily table names. Path-like ids such as `orders.items` are preferred
because they make nested graphs easy to read.

Every level declares:

- `table`: the `TableSchema` for rows at that level.
- `childLevels`: child level ids in display order.
- `parent`: required for non-root levels.
- `query`: optional query policy and defaults.
- `columns`: optional column specs or a column builder callback.
- `rowsClient`: optional custom row transport.

## Query Ownership

`query.owner` decides where a level gets page/sort/filter/search state.

Host-owned levels are controlled by UI state. They get a Zustand query store and
can be used with `useTGridQueryState`.

```ts
query: { owner: "host", pageSize: 50, urlSync: true }
```

Source-owned levels do not have query stores. They use the expansion path plus
static defaults from the definition. This is the normal choice for child rows.

```ts
query: {
  owner: "source",
  pageSize: 25,
  initialPage: 1,
  initialSort: [{ colId: "line_no", direction: "asc" }],
}
```

If `owner` is omitted, the root level defaults to `host` and child levels default
to `source`.

Host-owned initial values are session seeds, not definition data:

```ts
const session = useTGridSession(ordersGrid, {
  hostQuerySeeds: {
    orders: {
      page: 1,
      sort: [{ colId: "customer", direction: "asc" }],
      filters: [],
      search: null,
    },
  },
});
```

Seeds are read when the session creates its query stores. URL changes after that
should call `session.queryStore.getState().syncFromUrl(...)` or the store for the
specific host-owned level.

## Sessions

A session is the live grid instance. In React, create it with
`useTGridSession`. The hook returns `null` until the session is mounted and
disposes the old session when the definition identity changes or the component
unmounts.

```tsx
const session = useTGridSession(ordersGrid, {
  services,
  onQueryUrlChange,
  hostQuerySeeds,
});

if (!session) return <Spinner />;

return <TGrid session={session} />;
```

Outside React, dispose manually:

```ts
const session = createTGridSession(ordersGrid, {
  services,
  hostQuerySeeds,
});

try {
  session.rootSource.refetch();
} finally {
  session.dispose();
}
```

`services`, `onQueryUrlChange`, and `hostQuerySeeds` are passed as live inputs to
`useTGridSession`. Updating `services` or callbacks does not rebuild the session;
the hook keeps the latest values available through a ref. Changing the definition
object does rebuild the session.

## Columns

If a level has no `columns` declaration, TGrid maps every visible table column in
schema order. If `columns` is supplied, the declaration order is the rendered
order.

```ts
columns: (columns) => [
  columns.table("customer_id", { header: "Customer" }),
  columns.client("balance_status", {
    header: "Status",
    readsRowFields: ["balance"],
    invalidatedBy: ["balance"],
    renderCell: BalanceStatusCell,
  }),
  columns.remainingTable({ exclude: ["id", "customer_id"] }),
]
```

Use `columns.table(...)` for real table fields. Use `columns.client(...)` for
computed or action columns that are not persisted directly. Use
`columns.remainingTable(...)` to append all visible table columns not already
declared.

Column options can set headers, widths, editability, edit triggers, custom
renderers, custom editors, and custom save handlers. A `saveCellValue` handler
can return:

- `{ kind: "value", value }` to replace the edited value.
- `{ kind: "patch", patch }` to patch several fields.
- `{ kind: "row", row }` to replace the loaded row.
- `{ kind: "reload" }` to force a reload.

## Cell Hooks and Services

Use `useTGridCell(levelId)` inside custom renderers and
`useTGridCellEditor(levelId, column)` inside custom editors.

```tsx
function QuantityCell() {
  const cell = useTGridCell<RowsByLevel, AppServices, "orders.items">(
    "orders.items",
  );
  return <span>{cell.row.quantity}</span>;
}
```

The hooks verify that the renderer/editor is mounted for the level it was
declared for. Custom renderers, editors, and save handlers receive the current
row, value, row key, grid path, runtime, and `appServices`.

## Custom Row Clients

By default, every level uses Sapporta's table APIs:

- `fetchTableRows`
- `createTableRow`
- `updateTableRow`
- `deleteTableRow`

Override `rowsClient` on a level to route reads or writes elsewhere while keeping
the same grid runtime.

```ts
import type { TableRowsClient } from "@sapporta/ui";

const rowsClient = {
  fetch: async (params) => fetchInvoiceRows(params),
  create: async (tableName, row) => createInvoiceRow(tableName, row),
  update: async (tableName, id, patch) => updateInvoiceRow(tableName, id, patch),
  remove: async (tableName, id) => deleteInvoiceRow(tableName, id),
} satisfies TableRowsClient;

const grid = defineTGrid<RowsByLevel>({
  rootLevel: "invoices",
  levels: {
    invoices: {
      table: invoicesTable,
      childLevels: [],
      rowsClient,
    },
  },
});
```

For child inserts, TGrid adds the parent foreign-key value before calling
`rowsClient.create`.

## Schema-Driven Table Pages

The built-in table page uses the same TGrid pipeline. It converts
`TableSchema.children` into an explicit level graph, creates a definition, seeds
the root query store from URL/search preferences, then keeps URL and store state
in sync.

```tsx
const definition = useMemo(() => {
  const sessionConfig = buildSessionLevelsFromTableGridGraph({
    graph: buildTableGridGraphFromSchema({
      rootTableName: tableSchema.name,
      tablesByName,
    }),
    rootLevelQuery: {
      urlSync: true,
    },
  });
  return defineTGrid<SchemaDrivenRowsByLevel>(sessionConfig);
}, [tableSchema, tablesByName]);

const session = useTGridSession(definition, {
  onQueryUrlChange,
  hostQuerySeeds: {
    [tableName]: {
      sort: initialSort,
      filters: initial.filters,
      search: initial.search,
      page: initial.page,
    },
  },
});

useEffect(() => {
  if (!session) return;
  session.queryStore.getState().syncFromUrl(parseUrl(searchParams));
}, [session, searchParams]);
```

URL-derived seeds do not belong in the definition. Changing the URL updates the
existing query store. Changing the definition creates a new session.

## Public Helpers

These helpers are exported from `@sapporta/ui`:

- `createColumnsBuilder(levelId)` creates a typed column builder.
- `defineTableSchema(name, input)` builds a named table schema value.
- `applySchemaOverrides(levelId, schema, overrides)` applies typed schema
  overlays.
- `buildTableGridGraphFromSchema(...)` and
  `buildSessionLevelsFromTableGridGraph(...)` create schema-driven definitions.
- `buildTableSearchParams(...)`, `parseTableSearchParams(...)`, and
  `tableFilteredByUrl(...)` handle table URL state.
- `startTGridLookupLoading(session)` starts FK label cache loading for a live
  session.
