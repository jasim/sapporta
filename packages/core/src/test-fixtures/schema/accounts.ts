import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { table } from "../../schema/table.js";

// SQLite has no native enum type. Enum values are expressed as
// text({ enum: [...] }) directly in the column definition.
export default table({
  drizzle: sqliteTable("accounts", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    account_type: text("account_type", {
      enum: ["Asset", "Liability", "Equity", "Revenue", "Expense"],
    }).notNull(),
  }),
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
