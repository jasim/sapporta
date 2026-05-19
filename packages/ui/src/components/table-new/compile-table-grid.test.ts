import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import type { Row, TableSchema } from "@sapporta/shared/contracts";
import type { RestEndpointFactory } from "@/grid";
import { ExpandCell } from "../../grid/react/cells/ExpandCell";
import { preset } from "../../column-preset";
import { compileTableGrid, type TableFilter } from "./compile-table-grid";
import type { TableGridThemeContext } from "./table-grid-theme";

describe("compileTableGrid", () => {
  const orderSchema: TableSchema = {
    name: "orders",
    label: "Orders",
    immutable: false,
    columns: [
      { name: "id", primary: true, kind: "number" },
      { name: "customer", kind: "text" },
      { name: "internal", kind: "text", visuallyHidden: true },
    ],
    children: [
      {
        table: "lines",
        foreignKey: "order_id",
        label: "Lines",
        columns: ["line_no", "sku"],
        defaultSort: "line_no",
      },
    ],
  };

  const lineSchema: TableSchema = {
    name: "lines",
    label: "Lines",
    immutable: false,
    columns: [
      { name: "id", primary: true, kind: "number" },
      { name: "order_id", kind: "number" },
      { name: "line_no", kind: "number" },
      { name: "sku", kind: "text" },
      { name: "cost", kind: "number" },
    ],
    children: [
      {
        table: "allocations",
        foreignKey: "line_id",
        label: "Allocations",
        columns: ["warehouse"],
        defaultSort: "-warehouse",
      },
    ],
  };

  const allocationSchema: TableSchema = {
    name: "allocations",
    label: "Allocations",
    immutable: true,
    columns: [
      { name: "id", primary: true, kind: "number" },
      { name: "line_id", kind: "number" },
      { name: "warehouse", kind: "text" },
    ],
    children: [],
  };

  function compile(
    api?: Partial<Parameters<typeof compileTableGrid>[0]["api"]>,
  ) {
    const theme: TableGridThemeContext = {
      lookupBundleFor: () => undefined,
    };
    return compileTableGrid({
      rootTable: orderSchema,
      tablesByName: {
        orders: orderSchema,
        lines: lineSchema,
        allocations: allocationSchema,
      },
      theme,
      rootStatePolicy: {
        query: () => ({
          page: 2,
          pageSize: 25,
          sort: [{ colId: "customer", direction: "asc" }],
          filter: { conditions: [], search: "acme" },
        }),
      },
      childQueryPolicy: { pageSize: 10 },
      api: {
        fetchRows: vi.fn(),
        createRow: vi.fn(),
        updateRow: vi.fn(),
        deleteRow: vi.fn(),
        ...api,
      } as Parameters<typeof compileTableGrid>[0]["api"],
    });
  }

  it("emits stable semantic levels with child topology and table metadata", () => {
    const compiled = compile();

    expect(compiled.schema.rootLevel).toBe("orders");
    expect(Object.keys(compiled.schema.levels)).toEqual([
      "orders",
      "orders.lines",
      "orders.lines.allocations",
    ]);
    expect(compiled.schema.levels.orders.childLevels).toEqual(["orders.lines"]);
    expect(compiled.schema.levels["orders.lines"].childLevels).toEqual([
      "orders.lines.allocations",
    ]);
    expect(compiled.levelMetaById["orders.lines"]).toMatchObject({
      levelId: "orders.lines",
      tableName: "lines",
      parent: { parentLevelId: "orders", foreignKey: "order_id" },
    });
  });

  it("uses each table primary key as row identity", () => {
    const compiled = compile();
    const rootKey = compiled.schema.levels.orders.options.rowKey!;
    const childKey = compiled.schema.levels["orders.lines"].options.rowKey!;

    expect(rootKey({ levelName: "orders", columns: { id: 7 } }, 0)).toBe("7");
    expect(
      childKey({ levelName: "orders.lines", columns: { id: 42 } }, 0),
    ).toBe("42");
  });

  it("projects child visible columns from ChildSchema.columns", () => {
    const compiled = compile();

    expect(compiled.schema.levels.orders.columns.map((c) => c.id)).toEqual([
      "id",
      "customer",
    ]);
    expect(
      compiled.schema.levels["orders.lines"].columns.map((c) => c.id),
    ).toEqual(["line_no", "sku"]);
    expect(
      compiled.schema.levels["orders.lines.allocations"].columns.map(
        (c) => c.id,
      ),
    ).toEqual(["warehouse"]);
  });

  it("builds emitted columns through column-preset constructors", () => {
    const compiled = compile();

    for (const level of Object.values(compiled.schema.levels)) {
      for (const column of level.columns) {
        expect(preset(column)).toBeDefined();
      }
    }
  });

  it("wraps the first visible column of expandable levels with ExpandCell", () => {
    const compiled = compile();
    const col = compiled.schema.levels.orders.columns[0];
    const rendered = col.renderCell?.({
      value: 1,
      column: col,
      path: "orders" as never,
      row: {
        kind: "data",
        id: "orders#1" as never,
        columns: { id: 1 },
        hasChildren: false,
        source: { levelName: "orders", columns: { id: 1 } },
      },
    });

    expect(isValidElement(rendered)).toBe(true);
    expect(isValidElement(rendered) ? rendered.type : null).toBe(ExpandCell);
  });

  it("child endpoint applies the parent FK filter and default sort", async () => {
    const fetchRows = vi.fn(async () => ({
      data: [{ id: 10, order_id: 7, line_no: 1, sku: "A" }],
      meta: { total: 1, page: 1, limit: 10, pages: 1 },
    }));
    const compiled = compile({ fetchRows });
    const endpoint = (
      compiled.endpoints["orders.lines"] as RestEndpointFactory<TableFilter>
    )({
      ancestors: [{ levelName: "orders", rowKey: "7" }],
    });

    await endpoint.fetchPage(endpoint.query!());

    expect(fetchRows).toHaveBeenCalledWith({
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

  it("child insert seeds the parent FK at the adapter boundary", async () => {
    const createRow = vi.fn(async (_table: string, data: Row) => ({
      data: { id: 99, ...data },
    }));
    const compiled = compile({ createRow });
    const endpoint = (
      compiled.endpoints["orders.lines"] as RestEndpointFactory<TableFilter>
    )({
      ancestors: [{ levelName: "orders", rowKey: "7" }],
    });

    const inserted = await endpoint.insertNode!({
      node: { levelName: "orders.lines", columns: { sku: "A" } },
    });

    expect(createRow).toHaveBeenCalledWith("lines", {
      sku: "A",
      order_id: "7",
    });
    expect(inserted).toEqual({
      levelName: "orders.lines",
      columns: { id: 99, sku: "A", order_id: "7" },
    });
  });
});
