import { describe, expect, it } from "vitest";
import { foreignKey, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import {
  checkAuthSchemaDefinitions,
  clientPayloadPolicyIssues,
  resolveTableReferences,
  trustedScopeInsertValues,
} from "./index.js";
import type { SapportaAuthIdentity } from "./context.js";

const authIdentity: SapportaAuthIdentity = {
  session: { id: "session-1", userId: "user-1", activeWorkspaceId: "workspace-1" },
  user: { id: "user-1", name: "User One", email: "u1@example.com", emailVerified: true },
  workspace: { id: "workspace-1", name: "Workspace One", slug: "workspace-one", isOwner: false },
  member: { id: "member-1", role: "user" },
};
function scopedColumns() {
  return {
    workspace_id: text("workspace_id").notNull(),
    scoped_to_user_id: text("scoped_to_user_id").notNull(),
  };
}

describe("auth schema validation", () => {
  it("defaults omitted rowScope to current-user workspace scope", () => {
    const accounts = table({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
      }),
    });

    const issues = checkAuthSchemaDefinitions([accounts]);

    expect(accounts.meta.rowScope).toBe("workspaceUserScoped");
    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_workspace_scope_column",
      "missing_user_scope_column",
    ]);
  });

  it("enforces required workspace and scoped-user columns", () => {
    const workspaceGlobal = table({
      drizzle: sqliteTable("customers", {
        id: integer("id").primaryKey({ autoIncrement: true }),
      }),
      meta: { rowScope: "workspaceGlobal" },
    });
    const workspaceUserScoped = table({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceUserScoped" },
    });

    const issues = checkAuthSchemaDefinitions([workspaceGlobal, workspaceUserScoped]);

    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_workspace_scope_column",
      "missing_user_scope_column",
    ]);
  });

  it("rejects client-editable system-managed scope columns", () => {
    const orders = table({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        ...scopedColumns(),
      }),
      meta: {
        rowScope: "workspaceUserScoped",
        columns: { workspace_id: { clientEditable: true } },
      },
    });

    const issues = checkAuthSchemaDefinitions([orders]);

    expect(issues.map((issue) => issue.code)).toContain("system_managed_column_client_editable");
  });

  it("accepts valid workspace and system scoped tables", () => {
    const workspaceRows = table({
      drizzle: sqliteTable("workspace_rows", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal" },
    });
    const userRows = table({
      drizzle: sqliteTable("user_rows", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        ...scopedColumns(),
      }),
      meta: { rowScope: "workspaceUserScoped" },
    });
    const systemRows = table({
      drizzle: sqliteTable("system_rows", {
        id: integer("id").primaryKey({ autoIncrement: true }),
      }),
      meta: { rowScope: "systemGlobal" },
    });

    expect(checkAuthSchemaDefinitions([workspaceRows, userRows, systemRows])).toEqual([]);
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
    const accounts = table({ drizzle: accountsTable, meta: { rowScope: "workspaceGlobal" } });
    const invoices = table({ drizzle: invoicesTable, meta: { rowScope: "workspaceGlobal" } });

    const result = resolveTableReferences(invoices, [accounts, invoices]);

    expect(result.issues).toEqual([]);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      sourceColumn: "account_id",
      targetColumn: "id",
      targetTable: accounts,
      source: "drizzle",
      clientCanSet: true,
    });
  });

  it("resolves references from meta.references", () => {
    const accounts = table({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal" },
    });
    const invoices = table({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        account_id: integer("account_id"),
      }),
      meta: {
        rowScope: "workspaceGlobal",
        references: { account_id: { table: "accounts", column: "id", clientCanSet: false } },
      },
    });

    const result = resolveTableReferences(invoices, [accounts, invoices]);

    expect(result.issues).toEqual([]);
    expect(result.references[0]).toMatchObject({
      sourceColumn: "account_id",
      targetColumn: "id",
      targetTable: accounts,
      source: "meta",
      clientCanSet: false,
    });
  });

  it("fails unresolved references to unregistered tables", () => {
    const invoices = table({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        account_id: integer("account_id"),
      }),
      meta: {
        rowScope: "workspaceGlobal",
        references: { account_id: { table: "accounts" } },
      },
    });

    const result = resolveTableReferences(invoices, [invoices]);

    expect(result.issues.map((issue) => issue.code)).toContain("unregistered_reference_table");
  });

  it("fails references whose source column is not on the table", () => {
    const accounts = table({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal" },
    });
    const invoices = table({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: {
        rowScope: "workspaceGlobal",
        references: { account_id: { table: "accounts" } },
      },
    });

    const result = resolveTableReferences(invoices, [accounts, invoices]);

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "unknown_reference_source_column",
      column: "account_id",
    }));
  });

  it("fails meta.references that conflict with Drizzle foreign-key metadata", () => {
    const accountsTable = sqliteTable("accounts", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspace_id: text("workspace_id").notNull(),
    });
    const customers = table({
      drizzle: sqliteTable("customers", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal" },
    });
    const invoicesTable = sqliteTable("invoices", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspace_id: text("workspace_id").notNull(),
      account_id: integer("account_id").references(() => accountsTable.id),
    });
    const accounts = table({ drizzle: accountsTable, meta: { rowScope: "workspaceGlobal" } });
    const invoices = table({
      drizzle: invoicesTable,
      meta: {
        rowScope: "workspaceGlobal",
        references: { account_id: { table: "customers" } },
      },
    });

    const result = resolveTableReferences(invoices, [accounts, customers, invoices]);

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "conflicting_reference_rule",
      column: "account_id",
    }));
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
    const headers = table({ drizzle: orderHeaders, meta: { rowScope: "workspaceGlobal" } });
    const lines = table({ drizzle: orderLines, meta: { rowScope: "workspaceGlobal" } });

    const result = resolveTableReferences(lines, [headers, lines]);

    expect(result.issues.map((issue) => issue.code)).toContain("composite_reference");
  });

  it("rejects clientCanSet false and system-managed client fields", () => {
    const accounts = table({
      drizzle: sqliteTable("accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
      }),
      meta: { rowScope: "workspaceGlobal" },
    });
    const invoices = table({
      drizzle: sqliteTable("invoices", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        account_id: integer("account_id"),
      }),
      meta: {
        rowScope: "workspaceGlobal",
        references: { account_id: { table: "accounts", clientCanSet: false } },
      },
    });
    const references = resolveTableReferences(invoices, [accounts, invoices]).references;

    const issues = clientPayloadPolicyIssues(invoices, {
      workspace_id: "workspace-1",
      workspaceId: "workspace-1",
      account_id: 1,
    }, references);

    expect(issues.map((issue) => issue.field)).toEqual(["workspace_id", "workspaceId", "account_id"]);
  });

  it("computes trusted scope insert values in sql and typescript key forms", () => {
    const ordersTable = sqliteTable("orders", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspaceId: text("workspace_id").notNull(),
      scopedToUserId: text("scoped_to_user_id").notNull(),
    });
    const orders = table({ drizzle: ordersTable, meta: { rowScope: "workspaceUserScoped" } });

    const values = trustedScopeInsertValues(authIdentity, orders);

    expect(values.sql).toEqual({ workspace_id: "workspace-1", scoped_to_user_id: "user-1" });
    expect(values.typescript).toEqual({ workspaceId: "workspace-1", scopedToUserId: "user-1" });
  });

});
