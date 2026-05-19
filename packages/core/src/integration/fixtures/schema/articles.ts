import { table, timestamp } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Search fixture. Declares `meta.search` so the list endpoint exposes a
 * `q` query parameter that ORs an ILIKE match across `title` and `body`.
 * Kept separate from other fixtures so their tests stay decoupled.
 */
export const articles = table({
  drizzle: sqliteTable("articles", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull(),
    created_at: timestamp("created_at"),
    updated_at: timestamp("updated_at"),
  }),
  meta: {
    label: "Articles",
    selects: [
      { type: "select", column: "status", options: ["draft", "published", "archived"] },
    ],
    search: { columns: ["title", "body"] },
  },
});

export default articles;
