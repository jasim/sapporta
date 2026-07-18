import { sapportaTable, timestamp } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Search fixture. Declares `meta.search` so the list endpoint exposes a
 * `q` query parameter that ORs an ILIKE match across `title` and `body`.
 * Kept separate from other fixtures so their tests stay decoupled.
 */
export const articlesTable = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status", {
    enum: ["draft", "published", "archived"],
  }).notNull(),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  created_at: timestamp("created_at"),
  updated_at: timestamp("updated_at"),
});

export const articles = sapportaTable({
  drizzle: articlesTable,
  meta: {
    label: "Articles",
    rowScope: "workspaceUserScoped",
    rowLabelColumns: ["title"],
    search: { columns: ["title", "body"] },
  },
});

export default articles;
