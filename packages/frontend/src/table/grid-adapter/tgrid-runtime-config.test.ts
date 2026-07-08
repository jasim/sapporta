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
  GridRuntime,
  LevelRow,
  RestEndpointFactory,
  RowQueryState,
  SortDescriptor,
} from "@sapporta/grid";
import { ExpandableCellFrame } from "@sapporta/grid";
import { makeRowId, rootPath } from "@sapporta/grid";
import { preset } from "@sapporta/grid/column-preset";
import {
  StaticSearchLookup,
  StaticValueLookup,
  type LookupCapabilities,
} from "@sapporta/grid/lookup";
import { compileTGridRuntimeConfig, defineTGrid } from "./tgrid-runtime-config";
import type { TableRowsClient } from "./tgrid-level-config";
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
    const client = {
      fetch: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      ...rowsClient,
    } as TableRowsClient;

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

  it("uses each table primary key as row identity", () => {
    const config = build();
    const rootKey = config.gridSchema.levels.orders.options.rowKey!;
    const childKey = config.gridSchema.levels["orders.lines"].options.rowKey!;

    expect(rootKey({ levelName: "orders", columns: { id: 7 } }, 0)).toBe("7");
    expect(
      childKey({ levelName: "orders.lines", columns: { id: 42 } }, 0),
    ).toBe("42");
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
    const runtime = {} as GridRuntime;
    const session: TGridSessionContext<CopyRowsByLevel, CopyServices> = {
      rootLevel: "orders",
      runtime,
      levels: {} as TGridSessionContext<
        CopyRowsByLevel,
        CopyServices
      >["levels"],
      appServices: { suffix: "!" },
      lookups: emptyLookupStore(),
    };
    const config = compileTGridRuntimeConfig<CopyRowsByLevel, CopyServices>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: orderSchema,
          childLevels: [],
          columns: [
            orderColumns.table("customer", {
              copy: ({ values, runtime: copyRuntime, appServices }) => {
                expect(copyRuntime).toBe(runtime);
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
    const row: LevelRow = {
      kind: "data",
      id: makeRowId(rootPath("orders"), "7"),
      rowSelectable: true,
      columns: { id: 7, customer: "Acme" },
      hasChildren: false,
      source: {
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
    const rendered = col.renderCell?.({
      value: 1,
      column: col,
      path: "orders" as never,
      row: {
        kind: "data",
        id: "orders#1" as never,
        rowSelectable: true,
        columns: { id: 1 },
        hasChildren: false,
        source: { levelName: "orders", columns: { id: 1 } },
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
    const endpoint = (
      config.endpointFactoriesByLevel[
        "orders.lines"
      ] as RestEndpointFactory<TGridFilter>
    )({
      ancestors: [{ levelName: "orders", rowKey: "7" as never }],
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
          rowsClient: {
            fetch,
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          } as TableRowsClient,
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
              defaultSort: [{ colId: "kind" as never, direction: "asc" }],
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
          rowsClient: {
            fetch,
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          } as TableRowsClient,
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
      ancestors: [{ levelName: "orders", rowKey: "7" as never }],
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
          rowsClient: {
            fetch,
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          } as TableRowsClient,
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
      ancestors: [{ levelName: "orders", rowKey: "7" as never }],
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
      ancestors: [{ levelName: "orders", rowKey: "7" as never }],
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
      ancestors: [{ levelName: "orders", rowKey: "7" as never }],
    });

    const inserted = await endpoint.insertNode!({
      node: { levelName: "orders.lines", columns: { sku: "A" } },
    });

    expect(create).toHaveBeenCalledWith("lines", {
      sku: "A",
      order_id: "7",
    });
    expect(inserted).toEqual({
      levelName: "orders.lines",
      columns: { id: 99, sku: "A", order_id: "7" },
    });
  });

  it("uses typed column specs for ordering, client columns, and custom cell writes", async () => {
    type Services = { suffix: string };
    const columns = createTGridColumnsBuilder<RowsByLevel, Services, "orders">(
      "orders",
    );
    const session: TGridSessionContext<RowsByLevel, Services> = {
      rootLevel: "orders",
      runtime: {} as unknown as GridRuntime,
      appServices: { suffix: "saved" },
      lookups: emptyLookupStore(),
      levels: {} as unknown as TGridSessionContext<
        RowsByLevel,
        Services
      >["levels"],
    };
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
              saveCellValue: async (ctx) => ({
                kind: "row",
                row: {
                  ...ctx.row,
                  customer: `${ctx.value}-${ctx.appServices.suffix}`,
                },
              }),
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

    expect(config.gridSchema.levels.orders.columns.map((c) => c.id)).toEqual([
      "customer",
      "status",
    ]);
    expect(config.gridSchema.levels.orders.columns[0].name).toBe(
      "Customer Name",
    );

    const endpoint = config.endpointFactoriesByLevel.orders({ ancestors: [] });
    const result = await endpoint.patchCell!({
      rowKey: "1" as never,
      colId: "customer" as never,
      value: "ACME",
      row: { id: 1, customer: "Old" },
    });

    expect(result).toEqual({
      kind: "row",
      node: {
        levelName: "orders",
        columns: { id: 1, customer: "ACME-saved" },
      },
    });
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

    const session: TGridSessionContext<RowsByLevel, Services> = {
      rootLevel: "orders",
      runtime: {} as unknown as GridRuntime,
      appServices: { suffix: "saved" },
      lookups: emptyLookupStore(),
      levels: {} as unknown as TGridSessionContext<
        RowsByLevel,
        Services
      >["levels"],
    };
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
  });
});
