import { table } from "@sapporta/server/table";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agentsTable = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  workspace_id: text("workspace_id").notNull(),
});

export const agents = table({
  drizzle: agentsTable,
  meta: { label: "Agents", rowScope: "workspaceGlobal" },
});

export default agents;
