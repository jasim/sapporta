import { table, timestamp } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const accounts = table({
  drizzle: sqliteTable("accounts", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    balance: integer("balance"),
    created_at: timestamp("created_at"),
    updated_at: timestamp("updated_at"),
  }),
  meta: {
    label: "Accounts",
    selects: [
      { type: "select", column: "type", options: ["asset", "liability", "equity", "revenue", "expense"] },
    ],
  },
});

export default accounts;
