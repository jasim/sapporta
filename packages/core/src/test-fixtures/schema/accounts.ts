import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../../schema/table.js";

// Keep the Drizzle type and Sapporta's generated UI/validation metadata in sync
// by declaring each allowed account type once.
const accountTypeOptions = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
] as const;

// SQLite has no native enum type. Enum values are expressed as
// text({ enum: [...] }) directly in the column definition.
export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  account_type: text("account_type", {
    enum: accountTypeOptions,
  }).notNull(),
});

export const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: {
    label: "Accounts",
    rowLabelColumns: ["name"],
    selects: [
      {
        type: "select",
        column: "account_type",
        options: [...accountTypeOptions],
      },
    ],
  },
});

export default accounts;
