import { sapportaTable, timestamp } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Journal entries fixture. Deliberately omits Drizzle .references() on account_id
 * to keep the fixture simple — the FK is a logical relationship, not a DB constraint.
 * This matches many real-world Sapporta tables.
 */
export const journalEntriesTable = sqliteTable("journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account_id: integer("account_id").notNull(),
  description: text("description").notNull(),
  amount: integer("amount").notNull(),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  created_at: timestamp("created_at"),
});

export const journalEntries = sapportaTable({
  drizzle: journalEntriesTable,
  meta: {
    label: "Journal Entries",
    rowScope: "workspaceUserScoped",
    rowLabelColumns: ["description"],
    references: {
      account_id: { table: "accounts", column: "id" },
    },
  },
});

export default journalEntries;
