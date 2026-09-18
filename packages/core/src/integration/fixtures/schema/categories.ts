import { sapportaTable } from "@sapporta/server/table";
import {
  sqliteTable,
  text,
  integer,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

/**
 * Tree fixture: each category may name a parent category of the same table.
 */
export const categoriesTable = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  parent_id: integer("parent_id").references(
    (): AnySQLiteColumn => categoriesTable.id,
  ),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
});

export const categories = sapportaTable({
  drizzle: categoriesTable,
  meta: {
    label: "Categories",
    rowScope: "workspaceUserScoped",
    rowLabelColumns: ["name"],
    search: { self: ["name"] },
    tree: { parentColumn: "parent_id" },
  },
});

export default categories;
