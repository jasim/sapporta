import { table, timestamp } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Immutable table fixture. Tests that PUT/DELETE are rejected with 403
 * while POST still succeeds. The `immutable: true` flag is enforced by
 * the CRUD handlers in crud.ts (handleUpdate/handleDelete).
 */
export const auditLog = table({
  drizzle: sqliteTable("audit_log", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    event: text("event").notNull(),
    detail: text("detail"),
    created_at: timestamp("created_at"),
  }),
  meta: { label: "Audit Log", immutable: true },
});

export default auditLog;
