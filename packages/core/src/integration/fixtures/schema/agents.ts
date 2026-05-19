import { table } from "@sapporta/server/table";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = table({
  drizzle: sqliteTable("agents", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
  }),
  meta: { label: "Agents" },
});

export default agents;
