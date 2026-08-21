import { describe, expect, it, vi } from "vitest";
import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import {
  childPath,
  createGridRuntime,
  inMemoryGridDataSource,
  makeRowId,
  rootPath,
  type ColumnSchema,
  type GridSchema,
  type LevelSchema,
  type TreeNode,
} from "@sapporta/grid";
import { columnPreset } from "@sapporta/grid/column-preset";
import type { ValueLookup } from "@sapporta/grid/lookup";
import { startTGridLookupLoading } from "./tgrid-lookup-loading";
import type { TGridTableColumnMeta } from "./tgrid-column-mapper";

const ordersPath = rootPath("orders");
const linesPath = childPath(ordersPath, "42", "orders.lines");

const idColumn: TableColumnSchema = {
  name: "id",
  label: "ID",
  kind: "number",
  primary: true,
};
const customerColumn: TableColumnSchema = {
  name: "customer_id",
  label: "Customer",
  kind: "number",
  foreignKey: { table: "customers", column: "id" },
};
const productColumn: TableColumnSchema = {
  name: "product_id",
  label: "Product",
  kind: "number",
  foreignKey: { table: "products", column: "id" },
};

function makeGridColumn(args: {
  table: string;
  column: TableColumnSchema;
  valueLookup?: ValueLookup;
}): ColumnSchema {
  const meta = {
    table: args.table,
    schema: args.column,
    displayType: args.column.foreignKey ? "fk" : "number",
  } satisfies TGridTableColumnMeta;

  if (args.column.foreignKey && args.valueLookup) {
    return columnPreset.foreignKey({
      id: args.column.name,
      name: args.column.name,
      valueLookup: args.valueLookup,
      meta,
    });
  }

  return columnPreset.number({
    id: args.column.name,
    name: args.column.name,
    meta,
  });
}

function makeLevel(args: {
  name: string;
  table: string;
  columns: readonly TableColumnSchema[];
  childLevels?: readonly string[];
  valueLookupByColumn?: Readonly<Record<string, ValueLookup>>;
}): LevelSchema {
  return {
    name: args.name,
    columns: args.columns.map((column) =>
      makeGridColumn({
        table: args.table,
        column,
        valueLookup: args.valueLookupByColumn?.[column.name],
      }),
    ),
    rowHeaderColumn: "none",
    options: {},
    childLevels: args.childLevels ?? [],
  };
}

function makeValueLookup(
  loadMissingEntries: (values: readonly unknown[]) => Promise<void>,
): ValueLookup {
  return {
    entryForValue: vi.fn(),
    loadMissingEntries,
    subscribeToLookupChanges: vi.fn(() => () => {}),
  };
}

describe("startTGridLookupLoading", () => {
  it("loads FK labels through every registered path-bound level", () => {
    const customerLoad = vi.fn(async () => {});
    const productLoad = vi.fn(async () => {});
    const ordersLevel = makeLevel({
      name: "orders",
      table: "orders",
      columns: [idColumn, customerColumn],
      childLevels: ["orders.lines"],
      valueLookupByColumn: {
        customer_id: makeValueLookup(customerLoad),
      },
    });
    const linesLevel = makeLevel({
      name: "orders.lines",
      table: "lines",
      columns: [idColumn, productColumn],
      valueLookupByColumn: {
        product_id: makeValueLookup(productLoad),
      },
    });
    const schema = {
      rootLevel: "orders",
      levels: {
        orders: ordersLevel,
        "orders.lines": linesLevel,
      },
    } satisfies GridSchema;
    const lineNodes: TreeNode[] = [
      {
        rowKey: "1",
        levelName: "orders.lines",
        columns: { id: 1, product_id: "5" },
      },
      {
        rowKey: "2",
        levelName: "orders.lines",
        columns: { id: 2, product_id: "6" },
      },
    ];
    const runtime = createGridRuntime({
      schema,
      dataSource: inMemoryGridDataSource({
        schema,
        tree: [
          {
            rowKey: "42",
            levelName: "orders",
            columns: { id: 42, customer_id: "2" },
            children: { "orders.lines": lineNodes },
          },
          {
            rowKey: "43",
            levelName: "orders",
            columns: { id: 43, customer_id: "3" },
          },
        ],
        levels: {
          orders: {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
            readonly: true,
          },
          "orders.lines": {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
            readonly: true,
          },
        },
      }),
    });
    runtime.root.expand(makeRowId(ordersPath, "42"));
    expect(runtime.level(linesPath).path).toBe(linesPath);

    const stop = startTGridLookupLoading({ runtime });

    expect(customerLoad).toHaveBeenCalledWith(["2", "3"]);
    expect(productLoad).toHaveBeenCalledWith(["5", "6"]);

    stop();
    runtime.dispose();
  });
});
