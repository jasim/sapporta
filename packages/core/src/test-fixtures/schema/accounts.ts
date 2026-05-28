import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { table } from "../../schema/table.js";

// SQLite has no native enum type. Enum values are expressed as
// text({ enum: [...] }) directly in the column definition.
export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  account_type: text("account_type", {
    enum: ["Asset", "Liability", "Equity", "Revenue", "Expense"],
  }).notNull(),
});

export const accounts = table({
  drizzle: accountsTable,
  meta: {
    label: "Accounts",
    selects: [
      {
        type: "select",
        column: "account_type",
        options: ["Asset", "Liability", "Equity", "Revenue", "Expense"],
      },
    ],
  },
});

export default accounts;
