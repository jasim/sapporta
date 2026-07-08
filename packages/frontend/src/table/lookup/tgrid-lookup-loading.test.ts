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
  type SourceLoadResult,
  type TreeNode,
} from "@sapporta/grid";
import { columnPreset } from "@sapporta/grid/column-preset";
import type { ValueLookup } from "@sapporta/grid/lookup";
import type { TGridSession } from "../state/tgrid-session";
import { startTGridLookupLoading } from "./tgrid-lookup-loading";
import type { TGridTableColumnMeta } from "../grid-adapter/tgrid-column-mapper";

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
  columns: TableColumnSchema[];
  valueLookupByColumn?: Record<string, ValueLookup>;
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
    canWrite: false,
    state: () => ({
      status: "ready",
      snapshot: {
        nodes,
      },
    }),
    subscribe: vi.fn(() => unsubscribe),
    query: {
      refetch: () => unchangedResult(source.state()),
    },
    onReconcile: () => () => {},
  };
  return { source, unsubscribe };
}

function unchangedResult(
  state: ReturnType<RuntimeLevelDataSource["state"]>,
): Promise<SourceLoadResult> {
  return Promise.resolve({ kind: "unchanged", state });
}

function makeValueLookup(args: {
  loadMissingEntries: (values: readonly unknown[]) => Promise<void>;
}): ValueLookup {
  return {
    entryForValue: vi.fn(),
    loadMissingEntries: args.loadMissingEntries,
    subscribeToLookupChanges: vi.fn(() => () => {}),
  };
}

describe("startTGridLookupLoading", () => {
  it("loads FK labels for every registered table path", () => {
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
    const customerLookup = makeValueLookup({
      loadMissingEntries: customerLoad,
    });
    const productLookup = makeValueLookup({
      loadMissingEntries: productLoad,
    });
    const ordersLevel = makeLevel({
      name: "orders",
      table: "orders",
      columns: [idColumn, customerColumn],
      valueLookupByColumn: { customer_id: customerLookup },
    });
    const linesLevel = makeLevel({
      name: "orders.lines",
      table: "lines",
      columns: [idColumn, productColumn],
      valueLookupByColumn: { product_id: productLookup },
    });
    const runtime = {
      registeredPaths: () => [ordersPath, linesPath],
      sourceFor: (path: GridPath) =>
        path === ordersPath ? orderSource.source : linesSource.source,
      schemaAt: (path: GridPath) =>
        path === ordersPath ? ordersLevel : linesLevel,
      subscribeRegistry: () => () => {},
    } as unknown as GridRuntime;
    const session = {
      runtime,
    } as unknown as TGridSession;

    const stop = startTGridLookupLoading(session);

    expect(customerLoad).toHaveBeenCalledWith(["2", "3"]);
    expect(productLoad).toHaveBeenCalledWith(["5", "6"]);

    stop();
    expect(orderSource.unsubscribe).toHaveBeenCalledOnce();
    expect(linesSource.unsubscribe).toHaveBeenCalledOnce();
  });
});
