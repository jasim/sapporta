import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { CELL_GRID_WITH_ROW_CLICK_ACTIVATION } from "@sapporta/grid";
import { createLookupStore } from "../../lookup/store";
import { createTGridColumnMapper } from "./tgrid-column-mapper";
import { compileTGridRuntimeConfig, defineTGrid } from "./tgrid-runtime-config";
import {
  buildSchemaTGridConfig,
  defineSchemaTGrid,
  type SchemaTableColumns,
  type SchemaTableRowsByLevel,
} from "./schema-tgrid";
import type { TGridDefinition } from "./tgrid-runtime-config";

const ordersTable: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["customer"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "customer", label: "Customer", kind: "text" },
    { name: "note", label: "Note", kind: "text", gridEditable: false },
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
  searchable: true,
  rowLabelColumns: ["line_no"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "order_id", label: "Order", kind: "number" },
    { name: "line_no", label: "Line no", kind: "number" },
  ],
  children: [],
};

const accountsTable: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["name"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "name", label: "Name", kind: "text" },
    {
      name: "parent_id",
      label: "Parent",
      kind: "number",
      foreignKey: { table: "accounts", column: "id" },
    },
  ],
  children: [],
  tree: {
    parentColumn: "parent_id",
    column: "name",
    defaultExpanded: true,
    matchContext: "ancestors-and-descendants",
  },
};

const ordersSource = {
  rootTableName: "orders",
  tablesByName: { orders: ordersTable, order_lines: linesTable },
};

function compile(definition: TGridDefinition<SchemaTableRowsByLevel>) {
  return compileTGridRuntimeConfig({
    rootLevel: definition.rootLevel,
    levels: definition.levels,
    columnMapper: createTGridColumnMapper({ lookups: createLookupStore() }),
  });
}

function rootColumns(columns: SchemaTableColumns) {
  const definition = defineSchemaTGrid({ source: ordersSource, columns });
  return compile(definition).gridSchema.levels.orders.columns;
}

function rootColumnIds(columns: SchemaTableColumns) {
  return rootColumns(columns).map((column) => column.id);
}

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
    expect(definition.interaction).toBe(CELL_GRID_WITH_ROW_CLICK_ACTIVATION);
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

  it("adds a client column where the list puts it", () => {
    const edit = { label: "Edit", renderCell: () => "Edit" };

    expect(
      rootColumnIds((c) => [c.remainingTable(), c.client("edit", edit)]),
    ).toEqual(["id", "customer", "note", "edit"]);
    expect(
      rootColumnIds((c) => [
        c.table("id"),
        c.client("edit", edit),
        c.remainingTable(),
      ]),
    ).toEqual(["id", "edit", "customer", "note"]);
  });

  it("hides a column in the root level only", () => {
    const definition = defineSchemaTGrid({
      source: ordersSource,
      columns: (c) => [c.remainingTable({ exclude: ["customer"] })],
    });

    expect(
      compile(definition).gridSchema.levels.orders.columns.map(
        (column) => column.id,
      ),
    ).toEqual(["id", "note"]);
    expect(definition.levels["orders.order_lines"].columns).toBeUndefined();
  });

  it("changes a column in place, keeping schema order", () => {
    const columns = rootColumns((c) => [
      c.remainingTable({ columnOptions: { customer: { label: "Buyer" } } }),
    ]);

    expect(columns.map((column) => column.id)).toEqual([
      "id",
      "customer",
      "note",
    ]);
    expect(columns.map((column) => column.name)).toEqual([
      "ID",
      "Buyer",
      "Note",
    ]);
  });

  it("keeps a column the schema makes read-only read-only when it is changed", () => {
    const columns = rootColumns((c) => [
      c.remainingTable({
        columnOptions: {
          customer: { label: "Buyer" },
          note: { label: "Remark", edit: "default" },
        },
      }),
    ]);
    const edit = (id: string) =>
      columns.find((column) => column.id === id)?.edit;

    expect(edit("customer")).toBeDefined();
    expect(edit("note")).toBeUndefined();
  });

  it("moves a column the list names after remainingTable to that place", () => {
    expect(rootColumnIds((c) => [c.remainingTable(), c.table("id")])).toEqual([
      "customer",
      "note",
      "id",
    ]);
  });

  it("runs a level's columns callback when the grid builds, not when it is declared", () => {
    let calls = 0;
    const columns: SchemaTableColumns = (c) => {
      calls += 1;
      return [c.remainingTable()];
    };

    const definition = defineSchemaTGrid({ source: ordersSource, columns });
    expect(calls).toBe(0);

    compile(definition);
    expect(calls).toBe(1);
  });

  // Column names are checked when the grid builds, not when it is declared.
  it.each<[string, SchemaTableColumns, string]>([
    [
      "a table column",
      (c) => [c.table("line_no")],
      "buildTGridColumnsForTable: level 'orders' table 'orders' has no column 'line_no' to show",
    ],
    [
      "an excluded column",
      (c) => [c.remainingTable({ exclude: ["line_no"] })],
      "buildTGridColumnsForTable: level 'orders' table 'orders' has no column 'line_no' to exclude",
    ],
    [
      "a customized column",
      (c) => [
        c.remainingTable({ columnOptions: { line_no: { label: "Line" } } }),
      ],
      "buildTGridColumnsForTable: level 'orders' table 'orders' has no column 'line_no' to customize",
    ],
  ])("rejects %s the root table does not have", (_, columns, message) => {
    expect(() =>
      compile(defineSchemaTGrid({ source: ordersSource, columns })),
    ).toThrow(message);
  });

  it.each<[string, SchemaTableColumns, string]>([
    [
      "a client id that is a table column, even a hidden one",
      (c) => [
        c.remainingTable({ exclude: ["customer"] }),
        c.client("customer", { renderCell: () => null }),
      ],
      "buildTGridColumnsForTable: level 'orders' table 'orders' has a column 'customer', so a client column cannot use that id",
    ],
    [
      "options for a column remainingTable excludes",
      (c) => [
        c.remainingTable({
          exclude: ["customer"],
          columnOptions: { customer: { label: "Buyer" } },
        }),
      ],
      "buildTGridColumnsForTable: level 'orders' table 'orders' has columnOptions for 'customer', but this remainingTable does not add it, so the options would never apply. It adds: id, note",
    ],
    [
      "options for a column the list names with table()",
      (c) => [
        c.table("customer"),
        c.remainingTable({ columnOptions: { customer: { label: "Buyer" } } }),
      ],
      "buildTGridColumnsForTable: level 'orders' table 'orders' has columnOptions for 'customer', but this remainingTable does not add it, so the options would never apply. It adds: id, note",
    ],
    [
      "a table column shown twice",
      (c) => [c.table("id"), c.table("id")],
      "buildTGridColumnsForTable: level 'orders' table 'orders' shows column 'id' twice",
    ],
    [
      "two client columns with one id",
      (c) => [
        c.client("edit", { renderCell: () => null }),
        c.client("edit", { renderCell: () => null }),
      ],
      "buildTGridColumnsForTable: level 'orders' table 'orders' shows column 'edit' twice",
    ],
  ])("rejects %s", (_, columns, message) => {
    expect(() =>
      compile(defineSchemaTGrid({ source: ordersSource, columns })),
    ).toThrow(message);
  });

  it.each<[string, SchemaTableColumns]>([
    ["last", (c) => [c.remainingTable(), c.client("edit", { label: "Edit" })]],
    ["first", (c) => [c.client("edit", { label: "Edit" }), c.remainingTable()]],
  ])("keeps the tree column with a client column added %s", (_, columns) => {
    const definition = defineSchemaTGrid({
      source: {
        rootTableName: "accounts",
        tablesByName: { accounts: accountsTable },
      },
      columns,
    });
    const compiled = compile(definition);
    const name = compiled.gridSchema.levels.accounts.columns.find(
      (column) => column.id === "name",
    );

    expect(compiled.levelInfoById.accounts.tree?.column).toBe("name");
    // The tree column toggles its row's children from the keyboard.
    expect(name?.activation?.startsOn).toEqual(["enter", "space"]);
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
