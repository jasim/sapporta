import { describe, expect, it, vi } from "vitest";
import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import {
  childPath,
  rootPath,
  type ColumnSchema,
  type GridPath,
  type GridRuntime,
  type LevelSchema,
  type RuntimeLevelDataSource,
  type TreeNode,
} from "@/grid";
import type { NewTableHandle } from "./new-table-state";
import type { TableForeignKeyLookupBundle } from "./table-lookup-registry";
import { startTableLookupLoading } from "./table-lookup-loading";

const ordersPath = rootPath("orders");
const linesPath = childPath(ordersPath, "42", "orders.lines");

const idColumn: TableColumnSchema = {
  name: "id",
  kind: "number",
  primary: true,
};
const customerColumn: TableColumnSchema = {
  name: "customer_id",
  kind: "number",
  foreignKey: { table: "customers", column: "id" },
};
const productColumn: TableColumnSchema = {
  name: "product_id",
  kind: "number",
  foreignKey: { table: "products", column: "id" },
};

function makeGridColumn(args: {
  table: string;
  column: TableColumnSchema;
}): ColumnSchema {
  return {
    id: args.column.name,
    name: args.column.name,
    renderCell: ({ value }) => String(value ?? ""),
    meta: {
      table: args.table,
      schema: args.column,
      displayType: args.column.foreignKey ? "fk" : "number",
    },
  };
}

function makeLevel(args: {
  name: string;
  table: string;
  columns: TableColumnSchema[];
}): LevelSchema {
  return {
    name: args.name,
    columns: args.columns.map((column) =>
      makeGridColumn({ table: args.table, column }),
    ),
    options: {},
    childLevels: [],
  };
}

function makeNode(columns: Record<string, unknown>): TreeNode {
  return { levelName: "test", columns };
}

function makeSource(nodes: TreeNode[]) {
  const unsubscribe = vi.fn();
  const source: RuntimeLevelDataSource = {
    writable: false,
    snapshot: () => ({
      status: "ready",
      nodes,
      serverManaged: { sort: false, filter: false, pagination: false },
    }),
    subscribe: vi.fn(() => unsubscribe),
    setSort: () => {},
    setFilter: () => {},
    setPage: () => {},
    refetch: () => {},
    dispose: () => {},
    onReconcile: () => () => {},
  };
  return { source, unsubscribe };
}

function makeBundle(args: {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  loadMissingEntries: (values: readonly unknown[]) => Promise<void>;
}): TableForeignKeyLookupBundle {
  return {
    key: `${args.sourceTable}.${args.sourceColumn}->${args.targetTable}.id`,
    sourceTable: args.sourceTable,
    sourceColumn: args.sourceColumn,
    targetTable: args.targetTable,
    targetColumn: "id",
    valueLookup: {
      entryForValue: vi.fn(),
      loadMissingEntries: args.loadMissingEntries,
      subscribeToLookupChanges: vi.fn(() => () => {}),
      dispose: vi.fn(),
    },
    searchLookup: {
      cachedSearchResults: vi.fn(() => []),
      loadSearchResults: vi.fn(async () => ({ entries: [] })),
      subscribeToLookupChanges: vi.fn(() => () => {}),
      dispose: vi.fn(),
    },
  };
}

describe("startTableLookupLoading", () => {
  it("loads FK labels for every registered table path", () => {
    const ordersLevel = makeLevel({
      name: "orders",
      table: "orders",
      columns: [idColumn, customerColumn],
    });
    const linesLevel = makeLevel({
      name: "orders.lines",
      table: "lines",
      columns: [idColumn, productColumn],
    });
    const orderSource = makeSource([
      makeNode({ id: 42, customer_id: "2" }),
      makeNode({ id: 43, customer_id: "3" }),
    ]);
    const linesSource = makeSource([
      makeNode({ id: 1, product_id: "5" }),
      makeNode({ id: 2, product_id: "6" }),
    ]);
    const customerLoad = vi.fn(async () => {});
    const productLoad = vi.fn(async () => {});
    const customerBundle = makeBundle({
      sourceTable: "orders",
      sourceColumn: "customer_id",
      targetTable: "customers",
      loadMissingEntries: customerLoad,
    });
    const productBundle = makeBundle({
      sourceTable: "lines",
      sourceColumn: "product_id",
      targetTable: "products",
      loadMissingEntries: productLoad,
    });
    const lookupRegistry = {
      bundleFor: vi.fn(({ sourceTable, column }) => {
        if (sourceTable === "orders" && column.name === "customer_id") {
          return customerBundle;
        }
        if (sourceTable === "lines" && column.name === "product_id") {
          return productBundle;
        }
        return undefined;
      }),
      dispose: vi.fn(),
    };
    const runtime = {
      registeredPaths: () => [ordersPath, linesPath],
      sourceFor: (path: GridPath) =>
        path === ordersPath ? orderSource.source : linesSource.source,
      schemaAt: (path: GridPath) =>
        path === ordersPath ? ordersLevel : linesLevel,
      subscribeRegistry: () => () => {},
    } as unknown as GridRuntime;
    const handle = {
      runtime,
      lookupRegistry,
      levelMetaById: {
        orders: { levelId: "orders", tableName: "orders", childSchemas: [] },
        "orders.lines": {
          levelId: "orders.lines",
          tableName: "lines",
          parent: { parentLevelId: "orders", foreignKey: "order_id" },
          childSchemas: [],
        },
      },
    } as unknown as NewTableHandle;

    const stop = startTableLookupLoading(handle);

    expect(customerLoad).toHaveBeenCalledWith(["2", "3"]);
    expect(productLoad).toHaveBeenCalledWith(["5", "6"]);
    expect(lookupRegistry.bundleFor).toHaveBeenCalledWith({
      sourceTable: "orders",
      column: customerColumn,
    });
    expect(lookupRegistry.bundleFor).toHaveBeenCalledWith({
      sourceTable: "lines",
      column: productColumn,
    });

    stop();
    expect(orderSource.unsubscribe).toHaveBeenCalledOnce();
    expect(linesSource.unsubscribe).toHaveBeenCalledOnce();
  });
});
