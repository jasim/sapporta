import { describe, expect, it } from "vitest";
import {
  foreignKey,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../schema/table.js";
import {
  checkAuthSchemaDefinitions,
  apiWritePolicyIssues,
  requestDataAuthority,
  resolveTableReferences,
  systemGlobalOnlyAuthority,
  trustedInsertValuesForDataAuthority,
  workspaceGlobalOnlyAuthority,
  workspaceUserScopedAuthority,
} from "./index.js";
import type { RequestDataAuthority } from "./request-data-authority.js";

const testUser = {
  id: "user-1",
  name: "User One",
  email: "u1@example.com",
  emailVerified: true,
};
const testWorkspace = {
  id: "workspace-1",
  name: "Workspace One",
  slug: "workspace-one",
};
const dataAuthority: RequestDataAuthority = requestDataAuthority({
  systemGlobalOnly: systemGlobalOnlyAuthority(),
  workspaceGlobalOnly: workspaceGlobalOnlyAuthority(testWorkspace),
  workspaceUserScoped: workspaceUserScopedAuthority({
    workspace: testWorkspace,
    user: testUser,
  }),
});
function scopedColumns() {
  return {
    workspace_id: text("workspace_id").notNull(),
    scoped_to_user_id: text("scoped_to_user_id").notNull(),
  };
}

describe("auth schema validation", () => {
  it("defaults omitted rowScope to current-user workspace scope", () => {
    const accounts = sapportaTable({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
      }),
      meta: { rowLabelColumns: ["id"] },
    });

    const issues = checkAuthSchemaDefinitions([accounts]);

    expect(accounts.meta.rowScope).toBe("workspaceUserScoped");
    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_workspace_scope_column",
      "missing_user_scope_column",
    ]);
  });

  it("enforces required workspace and scoped-user columns", () => {
    const workspaceGlobal = sapportaTable({
      drizzle: sqliteTable("customers", {
        id: integer("id").primaryKey({ autoIncrement: true }),
      }),
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const workspaceUserScoped = sapportaTable({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceUserScoped", rowLabelColumns: ["id"] },
    });

    const issues = checkAuthSchemaDefinitions([
      workspaceGlobal,
      workspaceUserScoped,
    ]);

    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_workspace_scope_column",
      "missing_user_scope_column",
    ]);
  });

  it("rejects unknown row scope values before request-time policy checks", () => {
    const accounts = sapportaTable({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
      }),
      meta: { rowScope: "tenantScoped" as never, rowLabelColumns: ["id"] },
    });

    const issues = checkAuthSchemaDefinitions([accounts]);

    expect(issues).toMatchObject([
      {
        table: "accounts",
        code: "invalid_row_scope",
      },
    ]);
  });

  it("rejects API-writable system-managed scope columns", () => {
    const orders = sapportaTable({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        ...scopedColumns(),
      }),
      meta: {
        rowScope: "workspaceUserScoped",
        rowLabelColumns: ["id"],
        columns: { workspace_id: { apiWritable: true } },
      },
    });

    const issues = checkAuthSchemaDefinitions([orders]);

    expect(issues.map((issue) => issue.code)).toContain(
      "system_managed_column_api_writable",
    );
  });

  it("accepts valid workspace and system scoped tables", () => {
    const workspaceRows = sapportaTable({
      drizzle: sqliteTable("workspace_rows", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const userRows = sapportaTable({
      drizzle: sqliteTable("user_rows", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        ...scopedColumns(),
      }),
      meta: { rowScope: "workspaceUserScoped", rowLabelColumns: ["id"] },
    });
    const systemRows = sapportaTable({
      drizzle: sqliteTable("system_rows", {
        id: integer("id").primaryKey({ autoIncrement: true }),
      }),
      meta: { rowScope: "systemGlobal", rowLabelColumns: ["id"] },
    });

    expect(
      checkAuthSchemaDefinitions([workspaceRows, userRows, systemRows]),
    ).toEqual([]);
  });

  it("resolves references from Drizzle foreign-key metadata", () => {
    const accountsTable = sqliteTable("accounts", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspace_id: text("workspace_id").notNull(),
    });
    const invoicesTable = sqliteTable("invoices", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspace_id: text("workspace_id").notNull(),
      account_id: integer("account_id").references(() => accountsTable.id),
    });
    const accounts = sapportaTable({
      drizzle: accountsTable,
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const invoices = sapportaTable({
      drizzle: invoicesTable,
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });

    const result = resolveTableReferences(invoices, [accounts, invoices]);

    expect(result.issues).toEqual([]);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      sourceColumn: "account_id",
      targetColumn: "id",
      targetTable: accounts,
      source: "drizzle",
      apiSettable: true,
    });
  });

  it("resolves references from meta.references", () => {
    const accounts = sapportaTable({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const invoices = sapportaTable({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        account_id: integer("account_id"),
      }),
      meta: {
        rowScope: "workspaceGlobal",
        rowLabelColumns: ["id"],
        references: {
          account_id: { table: "accounts", column: "id", apiSettable: false },
        },
      },
    });

    const result = resolveTableReferences(invoices, [accounts, invoices]);

    expect(result.issues).toEqual([]);
    expect(result.references[0]).toMatchObject({
      sourceColumn: "account_id",
      targetColumn: "id",
      targetTable: accounts,
      source: "meta",
      apiSettable: false,
    });
  });

  it("fails unresolved references to unregistered tables", () => {
    const invoices = sapportaTable({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        account_id: integer("account_id"),
      }),
      meta: {
        rowScope: "workspaceGlobal",
        rowLabelColumns: ["id"],
        references: { account_id: { table: "accounts" } },
      },
    });

    const result = resolveTableReferences(invoices, [invoices]);

    expect(result.issues.map((issue) => issue.code)).toContain(
      "unregistered_reference_table",
    );
  });

  it("fails references whose source column is not on the table", () => {
    const accounts = sapportaTable({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const invoices = sapportaTable({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: {
        rowScope: "workspaceGlobal",
        rowLabelColumns: ["id"],
        references: { account_id: { table: "accounts" } },
      },
    });

    const result = resolveTableReferences(invoices, [accounts, invoices]);

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown_reference_source_column",
        column: "account_id",
      }),
    );
  });

  it("fails meta.references that conflict with Drizzle foreign-key metadata", () => {
    const accountsTable = sqliteTable("accounts", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspace_id: text("workspace_id").notNull(),
    });
    const customers = sapportaTable({
      drizzle: sqliteTable("customers", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const invoicesTable = sqliteTable("invoices", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspace_id: text("workspace_id").notNull(),
      account_id: integer("account_id").references(() => accountsTable.id),
    });
    const accounts = sapportaTable({
      drizzle: accountsTable,
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const invoices = sapportaTable({
      drizzle: invoicesTable,
      meta: {
        rowScope: "workspaceGlobal",
        rowLabelColumns: ["id"],
        references: { account_id: { table: "customers" } },
      },
    });

    const result = resolveTableReferences(invoices, [
      accounts,
      customers,
      invoices,
    ]);

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "conflicting_reference_rule",
        column: "account_id",
      }),
    );
  });

  it("fails composite foreign keys", () => {
    const orderHeaders = sqliteTable("order_headers", {
      id: integer("id").notNull(),
      workspace_id: text("workspace_id").notNull(),
    });
    const orderLines = sqliteTable(
      "order_lines",
      {
        id: integer("id").primaryKey({ autoIncrement: true }),
        order_id: integer("order_id").notNull(),
        workspace_id: text("workspace_id").notNull(),
      },
      (line) => [
        foreignKey({
          columns: [line.order_id, line.workspace_id],
          foreignColumns: [orderHeaders.id, orderHeaders.workspace_id],
        }),
      ],
    );
    const headers = sapportaTable({
      drizzle: orderHeaders,
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const lines = sapportaTable({
      drizzle: orderLines,
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });

    const result = resolveTableReferences(lines, [headers, lines]);

    expect(result.issues.map((issue) => issue.code)).toContain(
      "composite_reference",
    );
  });

  it("rejects apiSettable false and system-managed API fields", () => {
    const accounts = sapportaTable({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },
    });
    const invoices = sapportaTable({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        account_id: integer("account_id"),
      }),
      meta: {
        rowScope: "workspaceGlobal",
        rowLabelColumns: ["id"],
        references: { account_id: { table: "accounts", apiSettable: false } },
      },
    });
    const references = resolveTableReferences(invoices, [
      accounts,
      invoices,
    ]).references;

    const issues = apiWritePolicyIssues(
      invoices,
      {
        workspace_id: "workspace-1",
        workspaceId: "workspace-1",
        account_id: 1,
      },
      references,
    );

    expect(issues.map((issue) => issue.field)).toEqual([
      "workspace_id",
      "workspaceId",
      "account_id",
    ]);
  });

  it("enforces generated-primary-key and apiWritable policy on the server", () => {
    const invoices = sapportaTable({
      drizzle: sqliteTable("policy_invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        number: text("number").notNull(),
        internal_note: text("internal_note"),
      }),
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["number"],
        columns: { internal_note: { apiWritable: false } },
      },
    });

    expect(
      apiWritePolicyIssues(invoices, {
        id: 10,
        number: "INV-1",
        internal_note: "server only",
      }).map((issue) => issue.field),
    ).toEqual(["id", "internal_note"]);
  });

  it("computes trusted insert values for data authority in sql and typescript key forms", () => {
    const ordersTable = sqliteTable("orders", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspaceId: text("workspace_id").notNull(),
      scopedToUserId: text("scoped_to_user_id").notNull(),
    });
    const orders = sapportaTable({
      drizzle: ordersTable,
      meta: { rowScope: "workspaceUserScoped", rowLabelColumns: ["id"] },
    });

    const values = trustedInsertValuesForDataAuthority(dataAuthority, orders);

    expect(values.sql).toEqual({
      workspace_id: "workspace-1",
      scoped_to_user_id: "user-1",
    });
    expect(values.typescript).toEqual({
      workspaceId: "workspace-1",
      scopedToUserId: "user-1",
    });
  });
});
