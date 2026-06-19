import { table, timestamp } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  balance: integer("balance").notNull().default(0),
  workspace_id: text("workspace_id").notNull(),
  created_at: timestamp("created_at"),
  updated_at: timestamp("updated_at"),
});

export const accounts = table({
  drizzle: accountsTable,
  meta: {
    label: "Accounts",
    rowScope: "workspaceGlobal",
    selects: [
      {
        type: "select",
        column: "type",
        options: ["asset", "liability", "equity", "revenue", "expense"],
      },
    ],
  },
});

export default accounts;
