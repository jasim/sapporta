import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION } from "@sapporta/grid";
import { defineTGrid } from "./tgrid-runtime-config";
import { buildSchemaTGridConfig, defineSchemaTGrid } from "./schema-tgrid";

const ordersTable: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  rowLabelColumns: ["customer"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "customer", label: "Customer", kind: "text" },
  ],
  children: [
    {
      table: "order_lines",
      foreignKey: "order_id",
      label: "Order lines",
      columns: ["line_no"],
      defaultSort: "line_no",
    },
  ],
};

const linesTable: TableSchema = {
  name: "order_lines",
  label: "Order lines",
  immutable: false,
  rowLabelColumns: ["line_no"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "order_id", label: "Order", kind: "number" },
    { name: "line_no", label: "Line no", kind: "number" },
  ],
  children: [],
};

describe("schema TGrid helpers", () => {
  it("returns a definition for default schema-driven tables", () => {
    const definition = defineSchemaTGrid({
      source: {
        rootTableName: "orders",
        tablesByName: {
          orders: ordersTable,
          order_lines: linesTable,
        },
      },
    });

    expect(definition.rootLevel).toBe("orders");
    expect(Object.keys(definition.levels)).toEqual([
      "orders.order_lines",
      "orders",
    ]);
    expect(definition.levels.orders.childLevels).toEqual([
      "orders.order_lines",
    ]);
    expect(definition.levels["orders.order_lines"].parent).toEqual({
      level: "orders",
      foreignKey: "order_id",
      defaultSort: "line_no",
    });
    expect(definition.levels.orders.includedColumnNames).toBeUndefined();
    expect(definition.levels["orders.order_lines"].includedColumnNames).toEqual(
      ["line_no"],
    );
    expect(definition.levels.orders.rowHeaderColumn).toBeUndefined();
    expect(
      definition.levels["orders.order_lines"].rowHeaderColumn,
    ).toBeUndefined();
    expect(definition.interaction).toBe(
      CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    );
  });

  it("applies root query defaults", () => {
    const definition = defineSchemaTGrid({
      source: {
        rootTableName: "orders",
        tablesByName: {
          orders: ordersTable,
          order_lines: linesTable,
        },
      },
      rootRows: {
        urlSync: true,
        initialPage: 2,
        initialSearch: "open",
      },
    });

    expect(definition.levels.orders.query).toMatchObject({
      owner: "host",
      urlSync: true,
      initialPage: 2,
      initialSearch: "open",
    });
  });

  it("applies child query defaults", () => {
    const definition = defineSchemaTGrid({
      source: {
        rootTableName: "orders",
        tablesByName: {
          orders: ordersTable,
          order_lines: linesTable,
        },
      },
      relatedRows: {
        pageSize: 25,
        initialPage: 3,
      },
    });

    expect(definition.levels["orders.order_lines"].query).toMatchObject({
      owner: "source",
      pageSize: 25,
      initialPage: 3,
    });
  });

  it("returns level config callers can customize before defining a grid", () => {
    const columns = [
      { kind: "table" as const, columnName: "customer" as const },
    ];
    const config = buildSchemaTGridConfig({
      source: {
        rootTableName: "orders",
        tablesByName: {
          orders: ordersTable,
          order_lines: linesTable,
        },
      },
    });

    config.levels.orders.columns = columns;
    config.levels.orders.rowHeaderColumn = "none";
    config.levels["orders.order_lines"].rowHeaderColumn =
      "empty-selectable-cell";
    const definition = defineTGrid(config);

    expect(definition.levels.orders.columns).toBe(columns);
    expect(definition.levels.orders.rowHeaderColumn).toBe("none");
    expect(definition.levels["orders.order_lines"].rowHeaderColumn).toBe(
      "empty-selectable-cell",
    );
  });
});
