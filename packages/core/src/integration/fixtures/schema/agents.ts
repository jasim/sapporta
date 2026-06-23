import { sapportaTable } from "@sapporta/server/table";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agentsTable = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  workspace_id: text("workspace_id").notNull(),
});

export const agents = sapportaTable({
  drizzle: agentsTable,
  meta: {
    label: "Agents",
    rowScope: "workspaceGlobal",
    rowLabelColumns: ["name"],
  },
});

export default agents;
