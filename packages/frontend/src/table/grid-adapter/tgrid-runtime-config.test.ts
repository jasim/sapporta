// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, isValidElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Row, TableSchema } from "@sapporta/shared/contracts";
import {
  eqCondition,
  parseFiltersForTable,
  type FilterCondition,
  type TypedFilterCondition,
} from "@sapporta/shared/filter";
import type {
  FetchPageRequest,
  CellEditorProps,
  CellEditorStart,
  GridSchema,
  GridRuntime,
  LevelRow,
  RestEndpointFactory,
  RowQueryState,
  SortDescriptor,
} from "@sapporta/grid";
import {
  createGridRuntime,
  CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  ExpandableCellFrame,
  inMemoryGridDataSource,
} from "@sapporta/grid";
import { makeRowId, rootPath } from "@sapporta/grid";
import { preset } from "@sapporta/grid/column-preset";
import {
  StaticSearchLookup,
  StaticValueLookup,
  type LookupCapabilities,
} from "@sapporta/grid/lookup";
import { compileTGridRuntimeConfig, defineTGrid } from "./tgrid-runtime-config";
import type { TableRowsClient, TGridLevelConfig } from "./tgrid-level-config";
import type { TGridFilter } from "./tgrid-filter";
import { createTGridColumnMapper } from "./tgrid-column-mapper";
import { createTGridColumnsBuilder } from "./tgrid-column-spec";
import type {
  TGridCellEditorContext,
  TGridSessionContext,
} from "./tgrid-cell-context";
import type { LookupStore } from "../../lookup";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type OrderRow = { id: number; customer: string; internal?: string };
type LineRow = {
  id: number;
  order_id: number;
  line_no: number;
  sku: string;
  cost: number;
};
type AllocationRow = { id: number; line_id: number; warehouse: string };

type RowsByLevel = {
  orders: OrderRow;
  "orders.lines": LineRow;
  "orders.lines.allocations": AllocationRow;
};
type OrdersOnlyRows = { orders: OrderRow };

function emptyLookupStore(): LookupStore {
  const lookup: LookupCapabilities = {
    valueLookup: new StaticValueLookup([]),
    searchLookup: new StaticSearchLookup([]),
  };
  return {
    table: () => lookup,
    foreignKey: () => undefined,
    requireForeignKey: () => lookup,
    clear: () => undefined,
  };
}

function makeHostRowQueryState(seed: {
  page: number;
  pageSize: number;
  sort: readonly SortDescriptor[];
  filters: readonly TypedFilterCondition[];
  search: string | null;
}): RowQueryState<TGridFilter> {
  let state = {
    page: seed.page,
    pageSize: seed.pageSize,
    sort: [...seed.sort],
    filters: [...seed.filters],
    search: seed.search,
  };
  return {
    current: () => ({
      page: state.page,
      pageSize: state.pageSize,
      sort: [...state.sort],
      filter: { conditions: [...state.filters], search: state.search },
    }),
    setSortState: (sort) => {
      state = { ...state, sort: sort ? [...sort] : [], page: 1 };
      return "changed";
    },
    setFilterState: (filter) => {
      state = {
        ...state,
        filters: [...(filter?.conditions ?? [])],
        search: filter?.search ?? null,
        page: 1,
      };
      return "changed";
    },
    setPageState: (page, pageSize) => {
      state = { ...state, page, pageSize };
      return "changed";
    },
  };
}

function typedFilters(
  table: TableSchema,
  filters: readonly FilterCondition[],
): TypedFilterCondition[] {
  return parseFiltersForTable(filters, table);
}

function rowsRequest(
  endpoint: ReturnType<RestEndpointFactory<TGridFilter>>,
): FetchPageRequest<TGridFilter> {
  const buildRowsRequest = endpoint.buildRowsRequest ?? ((query) => query);
  return buildRowsRequest(endpoint.rowQuery.current());
}

function runtimeFor(schema: GridSchema): GridRuntime {
  return createGridRuntime({
    schema,
    interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    dataSource: inMemoryGridDataSource({
      schema,
      tree: [],
      levels: Object.fromEntries(
        Object.keys(schema.levels).map((levelName) => [
          levelName,
          {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
          },
        ]),
      ),
    }),
  });
}

function testRowsClient(
  overrides: Partial<TableRowsClient> = {},
): TableRowsClient {
  return {
    fetch: vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 1, limit: 50, pages: 0 },
    })),
    create: vi.fn(async (_table, data) => ({ data })),
    update: vi.fn(async (_table, _id, data) => ({ data })),
    remove: vi.fn(async (_table, id) => ({ data: { id } })),
    ...overrides,
  };
}

describe("compileTGridRuntimeConfig", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (!mounted) return;
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  });

  async function renderClient(element: ReactElement): Promise<void> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(element);
    });
    mounted = { root, container };
  }

  const orderSchema: TableSchema = {
    name: "orders",
    label: "Orders",
    immutable: false,
    rowLabelColumns: ["customer"],
    columns: [
      { name: "id", label: "ID", primary: true, kind: "number" },
      { name: "customer", label: "Customer", kind: "text" },
      {
        name: "internal",
        label: "Internal",
        kind: "text",
        visuallyHidden: true,
      },
    ],
    children: [],
  };

  const lineSchema: TableSchema = {
    name: "lines",
    label: "Lines",
    immutable: false,
    rowLabelColumns: ["sku"],
    columns: [
      { name: "id", label: "ID", primary: true, kind: "number" },
      { name: "order_id", label: "Order", kind: "number" },
      { name: "line_no", label: "Line no", kind: "number" },
      { name: "sku", label: "SKU", kind: "text" },
      { name: "cost", label: "Cost", kind: "number" },
    ],
    children: [],
  };

  const allocationSchema: TableSchema = {
    name: "allocations",
    label: "Allocations",
    immutable: true,
    rowLabelColumns: ["warehouse"],
    columns: [
      { name: "id", label: "ID", primary: true, kind: "number" },
      { name: "line_id", label: "Line", kind: "number" },
      { name: "warehouse", label: "Warehouse", kind: "text" },
    ],
    children: [],
  };

  function build(rowsClient?: Partial<TableRowsClient>) {
    const lookups = emptyLookupStore();
    const lineColumns = createTGridColumnsBuilder<
      RowsByLevel,
      unknown,
      "orders.lines"
    >("orders.lines");
    const allocationColumns = createTGridColumnsBuilder<
      RowsByLevel,
      unknown,
      "orders.lines.allocations"
    >("orders.lines.allocations");
    const client = testRowsClient(rowsClient);

    return compileTGridRuntimeConfig<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: ["orders.lines"],
          query: { owner: "host" },
          rowsClient: client,
        },
        "orders.lines": {
          table: lineSchema,
          parent: {
            level: "orders",
            foreignKey: "order_id",
            defaultSort: "line_no",
          },
          childLevels: ["orders.lines.allocations"],
          query: { owner: "source", pageSize: 10 },
          rowsClient: client,
          columns: [lineColumns.table("line_no"), lineColumns.table("sku")],
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: {
            level: "orders.lines",
            foreignKey: "line_id",
            defaultSort: "-warehouse",
          },
          childLevels: [],
          query: { owner: "source", pageSize: 10 },
          rowsClient: client,
          columns: [allocationColumns.table("warehouse")],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 2,
          pageSize: 25,
          sort: [{ colId: "customer", direction: "asc" }],
          filters: [],
          search: "acme",
        }),
    });
  }

  function buildOrdersOnly(
    overrides: Partial<TGridLevelConfig<OrdersOnlyRows>> = {},
  ) {
    return compileTGridRuntimeConfig<OrdersOnlyRows>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: [],
          ...overrides,
        },
      },
      columnMapper: createTGridColumnMapper({ lookups: emptyLookupStore() }),
    }).gridSchema.levels.orders;
  }

  it("emits stable semantic levels with child topology and table metadata", () => {
    const config = build();

    expect(config.gridSchema.rootLevel).toBe("orders");
    expect(Object.keys(config.gridSchema.levels)).toEqual([
      "orders",
      "orders.lines",
      "orders.lines.allocations",
    ]);
    expect(config.gridSchema.levels.orders.childLevels).toEqual([
      "orders.lines",
    ]);
    expect(config.gridSchema.levels["orders.lines"].childLevels).toEqual([
      "orders.lines.allocations",
    ]);
    expect(config.levelInfoById["orders.lines"]).toMatchObject({
      levelId: "orders.lines",
      tableName: "lines",
      parent: { parentLevelId: "orders", foreignKey: "order_id" },
    });
  });

  it("rejects host-owned query state on non-root levels", () => {
    const lookups = emptyLookupStore();
    const message =
      "non-root level 'orders.lines' cannot use query.owner \"host\"";

    expect(() =>
      defineTGrid<RowsByLevel>({
        rootLevel: "orders",
        levels: {
          orders: {
            table: orderSchema,
            childLevels: ["orders.lines"],
          },
          "orders.lines": {
            table: lineSchema,
            parent: { level: "orders", foreignKey: "order_id" },
            childLevels: ["orders.lines.allocations"],
            query: { owner: "host" },
          },
          "orders.lines.allocations": {
            table: allocationSchema,
            parent: { level: "orders.lines", foreignKey: "line_id" },
            childLevels: [],
          },
        },
      }),
    ).toThrow(message);

    expect(() =>
      compileTGridRuntimeConfig<RowsByLevel>({
        rootLevel: "orders",
        levels: {
          orders: {
            table: orderSchema,
            childLevels: ["orders.lines"],
          },
          "orders.lines": {
            table: lineSchema,
            parent: { level: "orders", foreignKey: "order_id" },
            childLevels: ["orders.lines.allocations"],
            query: { owner: "host" },
          },
          "orders.lines.allocations": {
            table: allocationSchema,
            parent: { level: "orders.lines", foreignKey: "line_id" },
            childLevels: [],
          },
        },
        columnMapper: createTGridColumnMapper({ lookups }),
      }),
    ).toThrow(message);
  });

  it("writes each table primary key into fetched TreeNode identity", async () => {
    const fetch = vi.fn<TableRowsClient["fetch"]>(async ({ tableName }) => ({
      data: tableName === "orders" ? [{ id: 7 }] : [{ id: 42 }],
      meta: { total: 1, page: 1, limit: 25, pages: 1 },
    }));
    const config = build({ fetch });
    const rootEndpoint = config.endpointFactoriesByLevel.orders({
      ancestors: [],
    });
    const childEndpoint = config.endpointFactoriesByLevel["orders.lines"]({
      ancestors: [{ levelName: "orders", rowKey: "7" }],
    });

    const rootResult = await rootEndpoint.fetchPage(rowsRequest(rootEndpoint));
    const childResult = await childEndpoint.fetchPage(
      rowsRequest(childEndpoint),
    );

    expect(rootResult.nodes[0]?.rowKey).toBe("7");
    expect(childResult.nodes[0]?.rowKey).toBe("42");
  });

  it("uses level-scoped columns instead of synthesizing from table children", () => {
    const config = build();

    expect(config.gridSchema.levels.orders.columns.map((c) => c.id)).toEqual([
      "id",
      "customer",
    ]);
    expect(
      config.gridSchema.levels["orders.lines"].columns.map((c) => c.id),
    ).toEqual(["line_no", "sku"]);
    expect(
      config.gridSchema.levels["orders.lines.allocations"].columns.map(
        (c) => c.id,
      ),
    ).toEqual(["warehouse"]);
  });

  it("resolves row headers from each level's final visible columns", () => {
    const config = build();

    expect(config.gridSchema.levels.orders.rowHeaderColumn).toEqual({
      column: "id",
    });
    expect(config.gridSchema.levels["orders.lines"].rowHeaderColumn).toBe(
      "empty-selectable-cell",
    );
    expect(
      config.gridSchema.levels["orders.lines.allocations"].rowHeaderColumn,
    ).toBe("empty-selectable-cell");
  });

  it.each([undefined, null])(
    "infers a left-most visible row-key column for %s",
    (rowHeaderColumn) => {
      const level = buildOrdersOnly({ rowHeaderColumn });

      expect(level.rowHeaderColumn).toEqual({ column: "id" });
      expect(level.columns[0]?.id).toBe("id");
      expect(level.columns[0]?.edit).toBeUndefined();
    },
  );

  it("uses the declared primary column for fetched TreeNode identity", async () => {
    type KeyedRows = {
      orders: { order_no: string; customer: string };
    };
    const keyedTable: TableSchema = {
      name: "orders",
      label: "Orders",
      immutable: false,
      rowLabelColumns: ["customer"],
      columns: [
        {
          name: "order_no",
          label: "Order no",
          primary: true,
          kind: "text",
        },
        { name: "customer", label: "Customer", kind: "text" },
      ],
      children: [],
    };

    const rowsClient: TableRowsClient = {
      fetch: vi.fn(async () => ({
        data: [{ order_no: "ORD-17", customer: "Acme" }],
        meta: { total: 1, page: 1, limit: 25, pages: 1 },
      })),
      create: vi.fn(async (_table, data) => ({ data })),
      update: vi.fn(async (_table, _id, data) => ({ data })),
      remove: vi.fn(async (_table, id) => ({ data: { id } })),
    };
    const config = compileTGridRuntimeConfig<KeyedRows>({
      rootLevel: "orders",
      levels: {
        orders: { table: keyedTable, childLevels: [], rowsClient },
      },
      columnMapper: createTGridColumnMapper({ lookups: emptyLookupStore() }),
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [],
          search: null,
        }),
    });
    const endpoint = config.endpointFactoriesByLevel.orders({ ancestors: [] });
    const fetched = await endpoint.fetchPage(rowsRequest(endpoint));

    expect(config.gridSchema.levels.orders.rowHeaderColumn).toEqual({
      column: "order_no",
    });
    expect(fetched.nodes[0]?.rowKey).toBe("ORD-17");
  });

  it("uses an empty selectable cell when the row-key column is not left-most or visible", () => {
    const columns = createTGridColumnsBuilder<
      OrdersOnlyRows,
      unknown,
      "orders"
    >("orders");
    const nonLeftMost = buildOrdersOnly({
      columns: [columns.table("customer"), columns.table("id")],
    });
    const missing = buildOrdersOnly({
      columns: [columns.table("customer")],
    });
    const empty = buildOrdersOnly({ columns: [] });

    expect(nonLeftMost.rowHeaderColumn).toBe("empty-selectable-cell");
    expect(nonLeftMost.columns.map((column) => column.id)).toEqual([
      "customer",
      "id",
    ]);
    expect(missing.rowHeaderColumn).toBe("empty-selectable-cell");
    expect(empty.rowHeaderColumn).toBe("empty-selectable-cell");
  });

  it("preserves explicit structural and disabled row headers", () => {
    expect(
      buildOrdersOnly({ rowHeaderColumn: "empty-selectable-cell" })
        .rowHeaderColumn,
    ).toBe("empty-selectable-cell");
    expect(buildOrdersOnly({ rowHeaderColumn: "none" }).rowHeaderColumn).toBe(
      "none",
    );
  });

  it("makes an explicit left-most data row header readonly after column overrides", () => {
    const columns = createTGridColumnsBuilder<
      OrdersOnlyRows,
      unknown,
      "orders"
    >("orders");
    const CustomEditor = () => null;
    const level = buildOrdersOnly({
      rowHeaderColumn: { column: "customer" },
      columns: [
        columns.table("customer", {
          edit: { editor: CustomEditor, startsOn: ["enter"] },
        }),
        columns.table("id"),
      ],
    });

    expect(level.rowHeaderColumn).toEqual({ column: "customer" });
    expect(level.columns[0]?.id).toBe("customer");
    expect(level.columns[0]?.edit).toBeUndefined();
  });

  it("rejects missing and non-left-most explicit row-header columns with context", () => {
    const columns = createTGridColumnsBuilder<
      OrdersOnlyRows,
      unknown,
      "orders"
    >("orders");

    expect(() =>
      buildOrdersOnly({
        rowHeaderColumn: { column: "missing" },
        columns: [columns.table("customer"), columns.table("id")],
      }),
    ).toThrow(
      /requested column "missing".*left-most column: "customer".*available columns: \[customer, id\]/,
    );
    expect(() =>
      buildOrdersOnly({
        rowHeaderColumn: { column: "id" },
        columns: [columns.table("customer"), columns.table("id")],
      }),
    ).toThrow(
      /requested column "id".*left-most column is "customer".*available columns: \[customer, id\]/,
    );
  });

  it("uses the level projection when default table columns are generated", () => {
    const lookups = emptyLookupStore();
    const config = compileTGridRuntimeConfig<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: ["orders.lines"],
        },
        "orders.lines": {
          table: lineSchema,
          includedColumnNames: ["line_no", "sku"],
          parent: {
            level: "orders",
            foreignKey: "order_id",
            defaultSort: "line_no",
          },
          childLevels: [],
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: { level: "orders.lines", foreignKey: "line_id" },
          childLevels: [],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [],
          search: null,
        }),
    });

    expect(config.gridSchema.levels.orders.columns.map((c) => c.id)).toEqual([
      "id",
      "customer",
    ]);
    expect(
      config.gridSchema.levels["orders.lines"].columns.map((c) => c.id),
    ).toEqual(["line_no", "sku"]);
  });

  it("uses the level projection for remaining table columns", () => {
    const lookups = emptyLookupStore();
    const lineColumns = createTGridColumnsBuilder<
      RowsByLevel,
      unknown,
      "orders.lines"
    >("orders.lines");
    const config = compileTGridRuntimeConfig<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: ["orders.lines"],
        },
        "orders.lines": {
          table: lineSchema,
          includedColumnNames: ["line_no", "sku"],
          parent: {
            level: "orders",
            foreignKey: "order_id",
            defaultSort: "line_no",
          },
          childLevels: [],
          columns: [
            lineColumns.table("order_id"),
            lineColumns.remainingTable(),
          ],
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: { level: "orders.lines", foreignKey: "line_id" },
          childLevels: [],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [],
          search: null,
        }),
    });

    expect(
      config.gridSchema.levels["orders.lines"].columns.map((c) => c.id),
    ).toEqual(["order_id", "line_no", "sku"]);
  });

  it("adapts typed table and client copy behavior to grid rows", async () => {
    const lookups = emptyLookupStore();
    type CopyRowsByLevel = { orders: OrderRow };
    type CopyServices = { suffix: string };
    const orderColumns = createTGridColumnsBuilder<
      CopyRowsByLevel,
      CopyServices,
      "orders"
    >("orders");
    let session: TGridSessionContext<CopyRowsByLevel, CopyServices>;
    const config = compileTGridRuntimeConfig<CopyRowsByLevel, CopyServices>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: [],
          columns: [
            orderColumns.table("customer", {
              copy: ({ level, values, runtime: copyRuntime, appServices }) => {
                expect(copyRuntime).toBe(runtime);
                expect(level).toBe(runtime.root);
                return [
                  {
                    header: "customer_name",
                    valueAt: (row, rowIndex) =>
                      `${values[rowIndex]}:${row.id}${appServices.suffix}`,
                  },
                ];
              },
            }),
            orderColumns.client("customer_badge", {
              label: "Badge",
              copy: ({ rows, values }) => [
                {
                  header: "badge",
                  valueAt: (row, rowIndex) =>
                    `${row.customer}:${String(values[rowIndex])}:${rows.length}`,
                },
              ],
            }),
          ],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      sessionContext: () => session,
    });
    const runtime = runtimeFor(config.gridSchema);
    const levelConfig: TGridLevelConfig<
      CopyRowsByLevel,
      CopyServices,
      "orders"
    > = {
      table: orderSchema,
      childLevels: [],
    };
    session = {
      rootLevel: "orders",
      runtime,
      levels: {
        orders: {
          levelId: "orders",
          table: orderSchema,
          config: levelConfig,
          csvExportUrl: () => "",
        },
      },
      appServices: { suffix: "!" },
      lookups: emptyLookupStore(),
    };
    const row: LevelRow = {
      kind: "data",
      id: makeRowId(rootPath("orders"), "7"),
      rowSelectable: true,
      columns: { id: 7, customer: "Acme" },
      hasChildren: false,
      source: {
        rowKey: "7",
        levelName: "orders",
        columns: { id: 7, customer: "Acme" },
      },
    };
    const [customerColumn, badgeColumn] =
      config.gridSchema.levels.orders.columns;
    if (!customerColumn.copy || !badgeColumn.copy) {
      throw new Error("expected typed copy behavior");
    }

    const tableCopyColumns = await customerColumn.copy({
      path: rootPath("orders"),
      column: customerColumn,
      rows: [row],
    });
    const clientCopyColumns = await badgeColumn.copy({
      path: rootPath("orders"),
      column: badgeColumn,
      rows: [row],
    });

    expect(tableCopyColumns.map((copyColumn) => copyColumn.header)).toEqual([
      "customer_name",
    ]);
    expect(tableCopyColumns[0].valueAt(row, 0)).toBe("Acme:7!");
    expect(clientCopyColumns.map((copyColumn) => copyColumn.header)).toEqual([
      "badge",
    ]);
    expect(clientCopyColumns[0].valueAt(row, 0)).toBe("Acme:undefined:1");
    runtime.dispose();
  });

  it("builds emitted columns through column-preset constructors", () => {
    const config = build();

    for (const level of Object.values(config.gridSchema.levels)) {
      for (const column of level.columns) {
        expect(preset(column)).toBeDefined();
      }
    }
  });

  it("wraps the first visible column of expandable levels with ExpandableCellFrame", () => {
    const config = build();
    const col = config.gridSchema.levels.orders.columns[0];
    const path = rootPath("orders");
    const rendered = col.renderCell?.({
      value: 1,
      column: col,
      path,
      row: {
        kind: "data",
        id: makeRowId(path, "1"),
        rowSelectable: true,
        columns: { id: 1 },
        hasChildren: false,
        source: { rowKey: "1", levelName: "orders", columns: { id: 1 } },
      },
      activation: null,
    });

    expect(isValidElement(rendered)).toBe(true);
    expect(isValidElement(rendered) ? rendered.type : null).toBe(
      ExpandableCellFrame,
    );
    expect(col.activation).toBeDefined();
  });

  it("child endpoint applies the parent FK filter and default sort", async () => {
    const fetch = vi.fn(async () => ({
      data: [{ id: 10, order_id: 7, line_no: 1, sku: "A" }],
      meta: { total: 1, page: 1, limit: 10, pages: 1 },
    }));
    const config = build({ fetch });
    const endpoint = config.endpointFactoriesByLevel["orders.lines"]({
      ancestors: [{ levelName: "orders", rowKey: "7" }],
    });

    await endpoint.fetchPage(rowsRequest(endpoint));

    expect(fetch).toHaveBeenCalledWith({
      tableName: "lines",
      page: 1,
      limit: 10,
      sort: [{ colId: "line_no", direction: "asc" }],
      filters: [
        expect.objectContaining({
          column: "order_id",
          op: "eq",
          value: 7,
        }),
      ],
      search: undefined,
    });
  });

  it("applies fixed query filters without adding them to host query state", async () => {
    const fetch = vi.fn(async () => ({
      data: [{ id: 1, customer: "ACME" }],
      meta: { total: 1, page: 1, limit: 25, pages: 1 },
    }));
    const lookups = emptyLookupStore();
    const userFilter = eqCondition("customer", "ACME");
    const fixedFilter = eqCondition("status", "open");
    const orderSchemaWithStatus: TableSchema = {
      ...orderSchema,
      columns: [
        ...orderSchema.columns,
        { name: "status", label: "Status", kind: "text" },
      ],
    };
    const [typedUserFilter] = typedFilters(orderSchemaWithStatus, [userFilter]);
    const [typedFixedFilter] = typedFilters(orderSchemaWithStatus, [
      fixedFilter,
    ]);
    const config = compileTGridRuntimeConfig<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchemaWithStatus,
          childLevels: [],
          query: { owner: "host", fixedFilters: [fixedFilter] },
          rowsClient: testRowsClient({ fetch }),
        },
        "orders.lines": {
          table: lineSchema,
          parent: { level: "orders", foreignKey: "order_id" },
          childLevels: [],
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: { level: "orders.lines", foreignKey: "line_id" },
          childLevels: [],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [typedUserFilter],
          search: null,
        }),
    });

    const endpoint = config.endpointFactoriesByLevel.orders({ ancestors: [] });
    await endpoint.fetchPage(rowsRequest(endpoint));

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [typedFixedFilter, typedUserFilter],
      }),
    );
  });

  it("rejects array default sorts that reference unknown columns", () => {
    const lookups = emptyLookupStore();

    expect(() =>
      compileTGridRuntimeConfig<RowsByLevel>({
        rootLevel: "orders",
        levels: {
          orders: {
            table: orderSchema,
            childLevels: ["orders.lines"],
            query: { owner: "host" },
          },
          "orders.lines": {
            table: lineSchema,
            parent: {
              level: "orders",
              foreignKey: "order_id",
              defaultSort: [{ colId: "kind", direction: "asc" }],
            },
            childLevels: ["orders.lines.allocations"],
            query: { owner: "source", pageSize: 10 },
          },
          "orders.lines.allocations": {
            table: allocationSchema,
            parent: {
              level: "orders.lines",
              foreignKey: "line_id",
            },
            childLevels: [],
            query: { owner: "source", pageSize: 10 },
          },
        },
        columnMapper: createTGridColumnMapper({ lookups }),
      }),
    ).toThrow("unknown column id 'kind'");
  });

  it("source-owned endpoints honor initialPage", async () => {
    const fetch = vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 3, limit: 10, pages: 0 },
    }));
    const lookups = emptyLookupStore();
    const config = compileTGridRuntimeConfig<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: ["orders.lines"],
        },
        "orders.lines": {
          table: lineSchema,
          parent: { level: "orders", foreignKey: "order_id" },
          childLevels: [],
          query: { owner: "source", pageSize: 10, initialPage: 3 },
          rowsClient: testRowsClient({ fetch }),
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: { level: "orders.lines", foreignKey: "line_id" },
          childLevels: [],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [],
          search: null,
        }),
    });

    const endpoint = config.endpointFactoriesByLevel["orders.lines"]({
      ancestors: [{ levelName: "orders", rowKey: "7" }],
    });

    await endpoint.fetchPage(rowsRequest(endpoint));

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, limit: 10 }),
    );
  });

  it("source-owned endpoints type initial filters before row requests", async () => {
    const fetch = vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 1, limit: 10, pages: 0 },
    }));
    const lookups = emptyLookupStore();
    const config = compileTGridRuntimeConfig<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: ["orders.lines"],
        },
        "orders.lines": {
          table: lineSchema,
          parent: { level: "orders", foreignKey: "order_id" },
          childLevels: [],
          query: {
            owner: "source",
            pageSize: 10,
            initialFilters: [eqCondition("cost", "12")],
          },
          rowsClient: testRowsClient({ fetch }),
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: { level: "orders.lines", foreignKey: "line_id" },
          childLevels: [],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [],
          search: null,
        }),
    });

    const endpoint = config.endpointFactoriesByLevel["orders.lines"]({
      ancestors: [{ levelName: "orders", rowKey: "7" }],
    });

    await endpoint.fetchPage(rowsRequest(endpoint));

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({
            column: "cost",
            kind: "number",
            value: 12,
          }),
        ]),
      }),
    );
  });

  it("uses a child level initialSort before falling back to parent defaultSort", () => {
    const lookups = emptyLookupStore();
    const config = compileTGridRuntimeConfig<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: ["orders.lines"],
        },
        "orders.lines": {
          table: lineSchema,
          parent: {
            level: "orders",
            foreignKey: "order_id",
            defaultSort: "line_no",
          },
          childLevels: [],
          query: {
            owner: "source",
            initialSort: [{ colId: "sku", direction: "desc" }],
          },
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: { level: "orders.lines", foreignKey: "line_id" },
          childLevels: [],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [],
          search: null,
        }),
    });

    const endpoint = config.endpointFactoriesByLevel["orders.lines"]({
      ancestors: [{ levelName: "orders", rowKey: "7" }],
    });

    expect(rowsRequest(endpoint).sort).toEqual([
      { colId: "sku", direction: "desc" },
    ]);
  });

  it("child insert seeds the parent FK at the adapter boundary", async () => {
    const create = vi.fn(async (_table: string, data: Row) => ({
      data: { id: 99, ...data },
    }));
    const config = build({ create });
    const endpoint = config.endpointFactoriesByLevel["orders.lines"]({
      ancestors: [{ levelName: "orders", rowKey: "7" }],
    });

    const inserted = await endpoint.insertNode!({
      node: {
        rowKey: "draft-line",
        levelName: "orders.lines",
        columns: { sku: "A" },
      },
    });

    expect(create).toHaveBeenCalledWith("lines", {
      sku: "A",
      order_id: "7",
    });
    expect(inserted).toEqual({
      rowKey: "99",
      levelName: "orders.lines",
      columns: { id: 99, sku: "A", order_id: "7" },
    });
  });

  it("uses typed column specs for ordering, client columns, and custom cell writes", async () => {
    type Services = { suffix: string };
    const columns = createTGridColumnsBuilder<RowsByLevel, Services, "orders">(
      "orders",
    );
    let session: TGridSessionContext<RowsByLevel, Services>;
    const lookups = emptyLookupStore();
    const config = compileTGridRuntimeConfig<RowsByLevel, Services>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: [],
          query: { owner: "host" },
          columns: [
            columns.table("customer", {
              label: "Customer Name",
              saveCellValue: async (ctx) => {
                expect(ctx.level).toBe(runtime.root);
                return {
                  kind: "row",
                  row: {
                    ...ctx.row,
                    customer: `${ctx.value}-${ctx.appServices.suffix}`,
                  },
                };
              },
            }),
            columns.client("status", {
              label: "Status",
              renderCell: () => "ok",
            }),
            columns.remainingTable({ exclude: ["id"] }),
          ],
        },
        "orders.lines": {
          table: lineSchema,
          parent: { level: "orders", foreignKey: "order_id" },
          childLevels: [],
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: { level: "orders.lines", foreignKey: "line_id" },
          childLevels: [],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      sessionContext: () => session,
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [],
          search: null,
        }),
    });
    const runtime = runtimeFor(config.gridSchema);
    session = {
      rootLevel: "orders",
      runtime,
      appServices: { suffix: "saved" },
      lookups: emptyLookupStore(),
      levels: {
        orders: {
          levelId: "orders",
          table: orderSchema,
          config: { table: orderSchema, childLevels: [] },
          csvExportUrl: () => "",
        },
        "orders.lines": {
          levelId: "orders.lines",
          table: lineSchema,
          config: {
            table: lineSchema,
            parent: { level: "orders", foreignKey: "order_id" },
            childLevels: [],
          },
          csvExportUrl: () => "",
        },
        "orders.lines.allocations": {
          levelId: "orders.lines.allocations",
          table: allocationSchema,
          config: {
            table: allocationSchema,
            parent: { level: "orders.lines", foreignKey: "line_id" },
            childLevels: [],
          },
          csvExportUrl: () => "",
        },
      },
    };

    expect(config.gridSchema.levels.orders.columns.map((c) => c.id)).toEqual([
      "customer",
      "status",
    ]);
    expect(config.gridSchema.levels.orders.columns[0].name).toBe(
      "Customer Name",
    );

    const endpoint = config.endpointFactoriesByLevel.orders({ ancestors: [] });
    const result = await endpoint.patchCell!({
      rowKey: "1",
      colId: "customer",
      value: "ACME",
      row: { id: 1, customer: "Old" },
    });

    expect(result).toEqual({
      kind: "row",
      node: {
        rowKey: "1",
        levelName: "orders",
        columns: { id: 1, customer: "ACME-saved" },
      },
    });
    runtime.dispose();
  });

  it("passes edit start metadata into typed custom editors", async () => {
    type Services = { suffix: string };
    const columns = createTGridColumnsBuilder<RowsByLevel, Services, "orders">(
      "orders",
    );
    const editStart: CellEditorStart = { trigger: "type", typedSeed: "A" };
    let observed: {
      editStart: CellEditorStart;
      value: string;
    } | null = null;

    function CustomerEditor(
      ctx: TGridCellEditorContext<RowsByLevel, Services, "orders", "customer">,
    ) {
      observed = {
        editStart: ctx.editStart,
        value: ctx.value,
      };
      return null;
    }

    let session: TGridSessionContext<RowsByLevel, Services>;
    const lookups = emptyLookupStore();
    const config = compileTGridRuntimeConfig<RowsByLevel, Services>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: [],
          query: { owner: "host" },
          columns: [
            columns.table("customer", {
              edit: {
                editor: CustomerEditor,
                startsOn: ["type"],
              },
            }),
          ],
        },
        "orders.lines": {
          table: lineSchema,
          parent: { level: "orders", foreignKey: "order_id" },
          childLevels: [],
        },
        "orders.lines.allocations": {
          table: allocationSchema,
          parent: { level: "orders.lines", foreignKey: "line_id" },
          childLevels: [],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups }),
      sessionContext: () => session,
      hostRowQueryState: () =>
        makeHostRowQueryState({
          page: 1,
          pageSize: 25,
          sort: [],
          filters: [],
          search: null,
        }),
    });
    const runtime = runtimeFor(config.gridSchema);
    session = {
      rootLevel: "orders",
      runtime,
      appServices: { suffix: "saved" },
      lookups: emptyLookupStore(),
      levels: {
        orders: {
          levelId: "orders",
          table: orderSchema,
          config: { table: orderSchema, childLevels: [] },
          csvExportUrl: () => "",
        },
        "orders.lines": {
          levelId: "orders.lines",
          table: lineSchema,
          config: {
            table: lineSchema,
            parent: { level: "orders", foreignKey: "order_id" },
            childLevels: [],
          },
          csvExportUrl: () => "",
        },
        "orders.lines.allocations": {
          levelId: "orders.lines.allocations",
          table: allocationSchema,
          config: {
            table: allocationSchema,
            parent: { level: "orders.lines", foreignKey: "line_id" },
            childLevels: [],
          },
          csvExportUrl: () => "",
        },
      },
    };
    const editor = config.gridSchema.levels.orders.columns[0].edit?.editor;
    expect(editor).toBeDefined();
    if (!editor) throw new Error("expected custom editor to be compiled");

    const path = rootPath("orders");
    const row: LevelRow = {
      kind: "data",
      id: makeRowId(path, "1"),
      rowSelectable: true,
      columns: { id: 1, customer: "Existing" },
      hasChildren: false,
      source: {
        rowKey: "1",
        levelName: "orders",
        columns: { id: 1, customer: "Existing" },
      },
    };
    const props: CellEditorProps = {
      editStart,
      value: "Existing",
      row,
      column: config.gridSchema.levels.orders.columns[0],
      path,
      anchor: document.createElement("div"),
      commit: () => {},
      cancel: () => {},
    };

    await renderClient(createElement(editor, props));

    expect(observed).toEqual({
      editStart,
      value: "Existing",
    });
    runtime.dispose();
  });
});
