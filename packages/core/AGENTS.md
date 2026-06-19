# @sapporta/server — AI Instructions

## After Modifying Schema, Reports, or Actions

After creating or modifying project schema files, run the app's normal build, migration generation/check flow, and startup path. Sapporta validates table definitions at server boot.

When creating or modifying reports, schemas, or actions, invoke the `/sapporta` skill to get specialist guidance and ensure all validation steps are followed.

## Dev Server

```bash
pnpm dev              # Start backend server (port 3000)
sapporta init <name>  # Create a new Sapporta project in ./<name>/
```

## Principles

### Schema-as-Code

Tables are defined as TypeScript files using a top-level Drizzle `sqliteTable` export plus Sapporta's `table()` wrapper. Schema changes are applied with native Drizzle Kit: run `pnpm --filter ./packages/api db:generate --name <change>`, review the SQL in `packages/api/migrations/`, then run `pnpm --filter ./packages/api db:migrate`. The server never applies migrations at runtime.

### No Coercion

Data is accepted as-is. Do not convert between types (e.g., no `"$95k"→9500`, no `"yes"→true`). Provide data in the exact type the column expects.

### Data Integrity

- Always look up foreign key values before inserting — never guess or fabricate IDs
- Respect NOT NULL constraints — include all required columns
- Omit auto-generated columns (id, created_at, updated_at) from inserts

### Derive Types from Schema

Row types come from the Drizzle schema: `typeof xTable.$inferSelect` for values read from the DB, `typeof xTable.$inferInsert` for values about to be written. Never hand-write a parallel `type FooRow = { ... }` — it drifts silently when columns change. See the `table-creation` skill for details.
