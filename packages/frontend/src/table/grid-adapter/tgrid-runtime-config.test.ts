import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import type { Row, TableSchema } from "@sapporta/shared/contracts";
import { eqCondition } from "@sapporta/shared/filter";
import type { GridRuntime, RestEndpointFactory } from "@sapporta/grid";
import { ExpandableCellFrame } from "@sapporta/grid";
import { preset } from "@sapporta/grid/column-preset";
import { compileTGridRuntimeConfig } from "./tgrid-runtime-config";
import type { TableRowsClient } from "./tgrid-level-config";
import type { TGridFilter } from "./tgrid-filter";
import { createTGridColumnMapper } from "./tgrid-column-mapper";
import type { TGridLookupResolver } from "./tgrid-lookup-resolver";
import { createTGridColumnsBuilder } from "./tgrid-column-spec";
import type { TGridSessionContext } from "./tgrid-cell-context";
import type { TableLookupRegistry } from "../lookup/table-lookup-registry";

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

describe("compileTGridRuntimeConfig", () => {
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
    const lookupResolver: TGridLookupResolver = {
      bundleFor: () => undefined,
    };
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
      columnMapper: createTGridColumnMapper(lookupResolver),
      hostQueryState: () => ({
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
    const lookupResolver: TGridLookupResolver = {
      bundleFor: () => undefined,
    };
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
      columnMapper: createTGridColumnMapper(lookupResolver),
      hostQueryState: () => ({
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
    const lookupResolver: TGridLookupResolver = {
      bundleFor: () => undefined,
    };
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
      columnMapper: createTGridColumnMapper(lookupResolver),
      hostQueryState: () => ({
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

    await endpoint.fetchPage(endpoint.query!());

    expect(fetch).toHaveBeenCalledWith({
      tableName: "lines",
      page: 1,
      limit: 10,
      sort: [{ colId: "line_no", direction: "asc" }],
      filters: [
        expect.objectContaining({
          column: "order_id",
          op: "eq",
          value: "7",
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
    const lookupResolver: TGridLookupResolver = {
      bundleFor: () => undefined,
    };
    const userFilter = eqCondition("customer", "ACME");
    const fixedFilter = eqCondition("status", "open");
    const config = compileTGridRuntimeConfig<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: {
            ...orderSchema,
            columns: [
              ...orderSchema.columns,
              { name: "status", label: "Status", kind: "text" },
            ],
          },
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
      columnMapper: createTGridColumnMapper(lookupResolver),
      hostQueryState: () => ({
        page: 1,
        pageSize: 25,
        sort: [],
        filters: [userFilter],
        search: null,
      }),
    });

    const endpoint = config.endpointFactoriesByLevel.orders({ ancestors: [] });
    await endpoint.fetchPage(endpoint.query!());

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [fixedFilter, userFilter],
      }),
    );
  });

  it("rejects array default sorts that reference unknown columns", () => {
    const lookupResolver: TGridLookupResolver = {
      bundleFor: () => undefined,
    };

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
        columnMapper: createTGridColumnMapper(lookupResolver),
      }),
    ).toThrow("unknown column id 'kind'");
  });

  it("source-owned endpoints honor initialPage", async () => {
    const fetch = vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 3, limit: 10, pages: 0 },
    }));
    const lookupResolver: TGridLookupResolver = {
      bundleFor: () => undefined,
    };
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
      columnMapper: createTGridColumnMapper(lookupResolver),
      hostQueryState: () => ({
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

    await endpoint.fetchPage(endpoint.query!());

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, limit: 10 }),
    );
  });

  it("uses a child level initialSort before falling back to parent defaultSort", () => {
    const lookupResolver: TGridLookupResolver = {
      bundleFor: () => undefined,
    };
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
      columnMapper: createTGridColumnMapper(lookupResolver),
      hostQueryState: () => ({
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

    expect(endpoint.query!().sort).toEqual([
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
      lookupRegistry: {} as unknown as TableLookupRegistry,
      levels: {} as unknown as TGridSessionContext<
        RowsByLevel,
        Services
      >["levels"],
    };
    const lookupResolver: TGridLookupResolver = {
      bundleFor: () => undefined,
    };
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
      columnMapper: createTGridColumnMapper(lookupResolver),
      sessionContext: () => session,
      hostQueryState: () => ({
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
});
