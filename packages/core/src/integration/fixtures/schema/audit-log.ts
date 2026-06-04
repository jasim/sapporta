import { table, timestamp } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Immutable table fixture. Tests that PUT/DELETE are rejected with 403
 * while POST still succeeds. The `immutable: true` flag is enforced by the
 * row-scoped table operations used by generated table routes.
 */
export const auditLogTable = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  event: text("event").notNull(),
  detail: text("detail"),
  created_at: timestamp("created_at"),
});

export const auditLog = table({
  drizzle: auditLogTable,
  meta: { label: "Audit Log", immutable: true, rowScope: "systemGlobal" },
});

export default auditLog;
