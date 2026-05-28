# Schema and Migrations

Sapporta projects use Drizzle Kit's native migration workflow.

```text
schema files -> drizzle-kit generate -> committed SQL migrations -> drizzle-kit migrate
```

Each schema module exports the raw Drizzle table object and the Sapporta wrapper:

```ts
export const accountsTable = sqliteTable("accounts", { ... });
export const accounts = table({ drizzle: accountsTable, meta: { label: "Accounts" } });
```

`drizzle.config.ts` points Drizzle Kit at `packages/api/schema/**/*.ts`. Drizzle Kit scans top-level exported Drizzle runtime objects such as `accountsTable`; Sapporta loads the `TableDef` exports such as `accounts`.

Workflow:

```bash
pnpm --filter ./packages/api db:generate --name add_accounts
pnpm --filter ./packages/api db:migrate
pnpm --filter ./packages/api db:check
```

Change schema, run Drizzle Kit generate, review SQL, run Drizzle Kit migrate, start server. The server never runs migrations.
