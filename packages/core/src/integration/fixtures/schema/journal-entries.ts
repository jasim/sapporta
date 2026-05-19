import { table, timestamp } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Journal entries fixture. Deliberately omits Drizzle .references() on account_id
 * to keep the fixture simple — the FK is a logical relationship, not a DB constraint.
 * This matches many real-world Sapporta tables.
 */
export const journalEntries = table({
  drizzle: sqliteTable("journal_entries", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    account_id: integer("account_id").notNull(),
    description: text("description").notNull(),
    amount: integer("amount").notNull(),
    created_at: timestamp("created_at"),
  }),
  meta: { label: "Journal Entries" },
});

export default journalEntries;
