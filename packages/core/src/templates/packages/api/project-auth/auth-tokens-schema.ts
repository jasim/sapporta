import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { organization, user } from "./schema.js";

/**
 * Workspace-scoped credentials for CLI, CI, and other non-browser clients.
 *
 * A token string has the form `spat_<id>_<secret>`. `id` selects this row and
 * `secretHash` verifies the secret; the raw secret is never stored. The
 * `organizationId` column is the workspace selected by the token, so data
 * commands do not need a separate workspace id.
 *
 * This table belongs to the project, so it lives beside `schema.ts`, which the
 * Better Auth CLI generates whole from the auth setup in `options.ts`.
 */
export const personalAccessToken = sqliteTable(
  "personalAccessToken",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    secretHash: text("secretHash").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }),
    lastUsedAt: integer("lastUsedAt", { mode: "timestamp_ms" }),
    revokedAt: integer("revokedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("personalAccessToken_userId_idx").on(table.userId),
    index("personalAccessToken_organizationId_idx").on(table.organizationId),
  ],
);

export const personalAccessTokenRelations = relations(
  personalAccessToken,
  ({ one }) => ({
    user: one(user, {
      fields: [personalAccessToken.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [personalAccessToken.organizationId],
      references: [organization.id],
    }),
  }),
);
