import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { timestamp, money, sapportaTable } from "./table.js";
import { Temporal } from "@sapporta/shared/temporal";
import { schemaApi, extractSchemas, extractSchema } from "./extract.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["asset", "liability", "equity", "revenue", "expense"],
  }).notNull(),
  balance: integer("balance"),
  active: integer("active", { mode: "boolean" }).default(true),
  created_at: timestamp("created_at")
    .notNull()
    .$defaultFn(() => Temporal.Now.instant()),
});

const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: {
    label: "Accounts",
    rowLabelColumns: ["name"],
    columns: { name: { apiWritable: false } },
  },
});

// Table with FK
const invoicesTable = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account_id: integer("account_id")
    .notNull()
    .references(() => accountsTable.id),
  amount: integer("amount").notNull(),
});

const invoices = sapportaTable({
  drizzle: invoicesTable,
  meta: { label: "Invoices", rowLabelColumns: ["id"] },
});

// Immutable table
const ledgerTable = sqliteTable("ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  description: text("description").notNull(),
});

const ledger = sapportaTable({
  drizzle: ledgerTable,
  meta: { immutable: true, rowLabelColumns: ["description"] },
});

// Table with money columns — factories stamp kind + displayFormat, so no
// per-column meta override is needed.
const transactionsTable = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  description: text("description").notNull(),
  debit: money("debit"),
  credit: money("credit"),
});

const transactions = sapportaTable({
  drizzle: transactionsTable,
  meta: {
    label: "Transactions",
    rowLabelColumns: ["description"],
  },
});

describe("extractSchemas", () => {
  it("extracts table metadata correctly", () => {
    const result = extractSchemas([accounts]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("accounts");
    expect(result[0].label).toBe("Accounts");
    expect(result[0].immutable).toBe(false);
  });

  it("exports resolved row-label columns", () => {
    const result = extractSchemas([accounts]);
    expect(result[0].rowLabelColumns).toEqual(["name"]);
  });

  it("exports declared primary-key row labels for minimal tables", () => {
    const result = extractSchemas([invoices]);
    expect(result[0].rowLabelColumns).toEqual(["id"]);
  });

  it("normalizes table defaults without storing author-supplied column labels", () => {
    expect(ledger.meta).toMatchObject({
      label: "ledger",
      rowScope: "workspaceUserScoped",
      immutable: true,
      references: {},
      children: [],
    });
    expect(ledger.meta.columns.description?.label).toBeUndefined();
  });

  it("extracts column metadata", () => {
    const result = extractSchemas([accounts]);
    const cols = result[0].columns;

    const idCol = cols.find((c) => c.name === "id")!;
    expect(idCol.primary).toBe(true);
    expect(idCol.hasDefault).toBe(true);
    expect(idCol.dataType).toBe("number");

    const nameCol = cols.find((c) => c.name === "name")!;
    expect(nameCol.notNull).toBe(true);
    expect(nameCol.dataType).toBe("string");
    expect(nameCol.primary).toBe(false);
    expect(nameCol.label).toBe("Name");
    expect(nameCol.apiWritable).toBe(false);

    const balanceCol = cols.find((c) => c.name === "balance")!;
    expect(balanceCol.notNull).toBe(false);
    expect(balanceCol.dataType).toBe("number");
    expect(balanceCol.label).toBe("Balance");
  });

  it("includes select metadata", () => {
    const result = extractSchemas([accounts]);
    const typeCol = result[0].columns.find((c) => c.name === "type")!;
    expect(typeCol.select).toEqual({
      options: ["asset", "liability", "equity", "revenue", "expense"],
    });
  });

  it("detects foreign keys", () => {
    const result = extractSchemas([invoices]);
    const fkCol = result[0].columns.find((c) => c.name === "account_id")!;
    expect(fkCol.foreignKey).toEqual({ table: "accounts", column: "id" });
    expect(fkCol.label).toBe("Account");
  });

  it("marks immutable tables", () => {
    const result = extractSchemas([ledger]);
    expect(result[0].immutable).toBe(true);
  });

  it("defaults label to sqlName", () => {
    const result = extractSchemas([ledger]);
    expect(result[0].label).toBe("ledger");
  });

  it("stamps currency displayFormat from money() factory", () => {
    const result = extractSchemas([transactions]);
    const cols = result[0].columns;

    const debitCol = cols.find((c) => c.name === "debit")!;
    expect(debitCol.kind).toBe("number");
    expect(debitCol.displayFormat).toBe("currency");

    const creditCol = cols.find((c) => c.name === "credit")!;
    expect(creditCol.kind).toBe("number");
    expect(creditCol.displayFormat).toBe("currency");

    const descCol = cols.find((c) => c.name === "description")!;
    expect(descCol.displayFormat).toBeUndefined();
  });

  it("leaves displayFormat unset when no column metadata", () => {
    const result = extractSchemas([accounts]);
    const cols = result[0].columns;
    for (const col of cols) {
      expect(col.displayFormat).toBeUndefined();
    }
  });

  it("extracts text display metadata", () => {
    const docsTable = sqliteTable("docs_with_body", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      body: text("body").notNull(),
    });
    const docs = sapportaTable({
      drizzle: docsTable,
      meta: {
        rowLabelColumns: ["body"],
        columns: {
          body: { textDisplay: "multiLine" },
        },
      },
    });

    const [result] = extractSchemas([docs]);
    const bodyCol = result.columns.find((c) => c.name === "body")!;
    expect(bodyCol.textDisplay).toBe("multiLine");
  });

  it("extracts numeric display metadata", () => {
    const balancesTable = sqliteTable("balances", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      balance: integer("balance").notNull(),
    });
    const balances = sapportaTable({
      drizzle: balancesTable,
      meta: {
        rowLabelColumns: ["id"],
        columns: {
          balance: {
            colorRule: "signed",
            zeroDisplay: "dot",
            strong: true,
          },
        },
      },
    });

    const [result] = extractSchemas([balances]);
    const balanceCol = result.columns.find((c) => c.name === "balance")!;
    expect(balanceCol.colorRule).toBe("signed");
    expect(balanceCol.zeroDisplay).toBe("dot");
    expect(balanceCol.strong).toBe(true);
  });

  it("auto-hides created_at and updated_at columns", () => {
    // Hidden by default in sapportaTable() so the UI table views don't show noisy timestamps.
    const result = extractSchemas([accounts]);
    const cols = result[0].columns;

    const createdAt = cols.find((c) => c.name === "created_at")!;
    expect(createdAt.visuallyHidden).toBe(true);
    expect(accounts.meta.columns.created_at?.visuallyHidden).toBe(true);

    // Columns that aren't created_at/updated_at should not be auto-hidden
    const nameCol = cols.find((c) => c.name === "name")!;
    expect(nameCol.visuallyHidden).toBeUndefined();
  });

  it("allows meta.columns to override auto-hidden timestamps", () => {
    const customTable = sqliteTable("audit", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      created_at: timestamp("created_at")
        .notNull()
        .$defaultFn(() => Temporal.Now.instant()),
    });
    const audit = sapportaTable({
      drizzle: customTable,
      meta: {
        rowLabelColumns: ["id"],
        columns: {
          created_at: { visuallyHidden: false },
        },
      },
    });

    const result = extractSchemas([audit]);
    const createdAt = result[0].columns.find((c) => c.name === "created_at")!;
    expect(createdAt.visuallyHidden).toBe(false);
  });

  it("resolves children from parent table's meta.children", () => {
    const ordersTable = sqliteTable("orders", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      customer: text("customer").notNull(),
      created_at: timestamp("created_at"),
      updated_at: timestamp("updated_at"),
    });
    const lineItemsTable = sqliteTable("line_items", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      order_id: integer("order_id")
        .notNull()
        .references(() => ordersTable.id),
      product: text("product").notNull(),
      quantity: integer("quantity").notNull(),
      created_at: timestamp("created_at"),
      updated_at: timestamp("updated_at"),
    });

    const orders = sapportaTable({
      drizzle: ordersTable,
      meta: {
        label: "Orders",
        rowLabelColumns: ["customer"],
        children: [{ table: "line_items", foreignKey: "order_id" }],
      },
    });
    const lineItems = sapportaTable({
      drizzle: lineItemsTable,
      meta: { label: "Line Items", rowLabelColumns: ["product"] },
    });

    const result = extractSchemas([orders, lineItems]);
    const orderSchema = result.find((s) => s.name === "orders")!;

    expect(orderSchema.children).toHaveLength(1);
    const child = orderSchema.children[0];
    expect(child.table).toBe("line_items");
    expect(child.foreignKey).toBe("order_id");
    expect(child.label).toBe("Line Items");

    // Auto-resolved columns should exclude: id, order_id, created_at, updated_at
    expect(child.columns).toContain("product");
    expect(child.columns).toContain("quantity");
    expect(child.columns).not.toContain("id");
    expect(child.columns).not.toContain("order_id");
    expect(child.columns).not.toContain("created_at");
    expect(child.columns).not.toContain("updated_at");

    // rowLinks synthesized from children — drill-into entries keyed to the
    // parent's PK. One link per child.
    expect(orderSchema.rowLinks).toHaveLength(1);
    expect(orderSchema.rowLinks![0]).toEqual({
      kind: "table",
      table: "line_items",
      bind: { order_id: "id" },
      label: "Open Line Items",
      icon: "drill-into",
    });

    // FK column on the child: links synthesized with drill-up icon hint.
    const lineItemsSchema = result.find((s) => s.name === "line_items")!;
    const orderFk = lineItemsSchema.columns.find((c) => c.name === "order_id")!;
    expect(orderFk.links).toHaveLength(1);
    expect(orderFk.links![0]).toEqual({
      kind: "table",
      table: "orders",
      bind: { id: "order_id" },
      icon: "drill-up",
    });
  });

  it("omits rowLinks when table has no children", () => {
    const standalone = sqliteTable("standalone", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      name: text("name").notNull(),
    });
    const t = sapportaTable({
      drizzle: standalone,
      meta: { label: "Standalone", rowLabelColumns: ["name"] },
    });
    const [result] = extractSchemas([t]);
    expect(result.rowLinks).toBeUndefined();
  });
});

describe("search config surfacing", () => {
  it("exposes search capability without serializing the server plan", () => {
    const searchableTable = sqliteTable("docs", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      title: text("title").notNull(),
      body: text("body").notNull(),
    });
    const docs = sapportaTable({
      drizzle: searchableTable,
      meta: {
        rowLabelColumns: ["title"],
        search: { self: ["title", "body"] },
      },
    });
    const [result] = extractSchemas([docs]);
    expect(result.searchable).toBe(true);
    expect(result).not.toHaveProperty("search");
  });

  it("enables search by default", () => {
    const [result] = extractSchemas([accounts]);
    expect(result.searchable).toBe(true);
  });

  it("exposes search: false as a disabled capability", () => {
    const privateNotes = sapportaTable({
      drizzle: sqliteTable("private_notes", {
        id: integer("id").primaryKey(),
        note: text("note").notNull(),
      }),
      meta: {
        rowLabelColumns: ["note"],
        search: false,
      },
    });
    const [result] = extractSchemas([privateNotes]);
    expect(result.searchable).toBe(false);
  });
});

describe("extractSchema (single-table lookup)", () => {
  it("returns schema for a known table", () => {
    const result = extractSchema([accounts, invoices], "accounts");
    expect(result).toBeDefined();
    expect(result!.name).toBe("accounts");
    expect(result!.label).toBe("Accounts");
  });

  it("returns undefined for unknown table", () => {
    const result = extractSchema([accounts], "nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("GET /api/meta/tables", () => {
  it("returns schema metadata via HTTP", async () => {
    const app = new Hono();
    app.route("/api/meta/tables", schemaApi([accounts, invoices]));

    const res = await app.request("/api/meta/tables");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tables).toHaveLength(2);
    expect(json.tables[0].name).toBe("accounts");
    expect(json.tables[1].name).toBe("invoices");
  });
});
