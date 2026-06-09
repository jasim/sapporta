import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { buildSchemaTGridConfig, defineSchemaTGrid } from "./schema-tgrid";

const ordersTable: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  columns: [
    { name: "id", primary: true, kind: "number" },
    { name: "customer", kind: "text" },
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
  columns: [
    { name: "id", primary: true, kind: "number" },
    { name: "order_id", kind: "number" },
    { name: "line_no", kind: "number" },
  ],
  children: [],
};

describe("schema TGrid helpers", () => {
  it("builds the same explicit level config used by schema-driven table pages", () => {
    const config = buildSchemaTGridConfig({
      rootTableName: "orders",
      tablesByName: {
        orders: ordersTable,
        order_lines: linesTable,
      },
      rootLevelQuery: { urlSync: true },
    });

    expect(config.rootLevel).toBe("orders");
    expect(Object.keys(config.levels)).toEqual([
      "orders.order_lines",
      "orders",
    ]);
    expect(config.levels.orders.query).toMatchObject({
      owner: "host",
      urlSync: true,
    });
    expect(config.levels["orders.order_lines"].parent).toEqual({
      level: "orders",
      foreignKey: "order_id",
      defaultSort: "line_no",
    });
  });

  it("returns a defineTGrid definition for default schema-driven tables", () => {
    const definition = defineSchemaTGrid({
      rootTableName: "orders",
      tablesByName: {
        orders: ordersTable,
        order_lines: linesTable,
      },
    });

    expect(definition.rootLevel).toBe("orders");
    expect(definition.levels.orders.childLevels).toEqual([
      "orders.order_lines",
    ]);
  });
});
