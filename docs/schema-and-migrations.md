# Schema and Migrations

Sapporta projects use Drizzle Kit's native migration workflow.

```text
schema files -> drizzle-kit generate -> committed SQL migrations -> drizzle-kit migrate
```

Each schema module exports the raw Drizzle table object and the Sapporta wrapper:

```ts
export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  name: text("name").notNull(),
});
export const accounts = table({
  drizzle: accountsTable,
  meta: { label: "Accounts" },
});
```

`drizzle.config.ts` points Drizzle Kit at `packages/api/schema/**/*.ts`. Drizzle Kit scans top-level exported Drizzle runtime objects such as `accountsTable`; Sapporta loads the `TableDef` exports such as `accounts`.

Sapporta defaults omitted `meta.rowScope` to `workspaceUserScoped`, so ordinary
tables need the conventional `workspace_id` and `scoped_to_user_id` columns
before migrations are generated. See [Sapporta Auth](auth.md).

Workflow:

```bash
pnpm --filter ./packages/api db:generate --name add_accounts
pnpm --filter ./packages/api db:migrate
pnpm --filter ./packages/api db:check
```

Change schema, run Drizzle Kit generate, review SQL, run Drizzle Kit migrate, start server. The server never runs migrations.
