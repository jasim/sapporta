# @sapporta/server

## Usage

Install the canonical CLI package to create and inspect Sapporta projects:

```bash
npx sapporta init my-app
```

```bash
npm install -g sapporta
sapporta init my-app
```

A Sapporta project owns its own entry point. Scaffolded projects (`sapporta init`) include a `boot.ts` that wires the framework into a Hono app and serves it directly. Run from the project root:

```bash
pnpm dev      # backend (port 3000) + frontend dev server
pnpm start    # production: node dist/boot.js
```

CLI commands that hit the API use `http://localhost:3000` by default. Set `SAPPORTA_API_URL` when the app API runs elsewhere. For protected apps, expose `SAPPORTA_API_TOKEN` to the agent or session instead of passing raw tokens in command text.

## Row-scoped table operations

Use `scopedRows()` for ordinary custom table operations. It is the trust-boundary constructor: pass the request database handle, the authenticated Sapporta auth context, and one table definition. The returned operations all compose reads and writes through `auth.rowSecurity.forTable(table)`.

```ts
import { scopedRows } from "@sapporta/server";
import { invoices } from "../schema/invoices.js";

api.register(
  "createInvoice",
  contract.createInvoice,
  async ({ c, request }) => {
    const auth = projectAuth.requireWorkspaceUser(c);
    const rows = scopedRows(c.get("db"), auth, invoices);

    const created = await rows.create(request.body);
    return { status: 201, body: { data: created } };
  },
);
```

Use `auth.rowSecurity.forTable(table)` directly for advanced Drizzle workflows such as joins, transactions, multi-table state transitions, aggregates, custom SQL, and domain-specific invariants.

## Environment variables

| Variable                         | Purpose                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SAPPORTA_DEV_MODE_PACKAGE_ROOT` | Monorepo root. When set, `create-project` uses `link:` specs instead of published versions. Must be set explicitly — see DEVELOPMENT.md. |
| `SAPPORTA_API_URL`               | Server URL for CLI commands. Default: `http://localhost:3000`.                                                                           |
| `SAPPORTA_API_TOKEN`             | Bearer token for protected API-backed CLI commands. Preferred for agents and automation.                                                 |
| `SAPPORTA_OUTPUT_FORMAT`         | Default CLI output format: `json` or `table`.                                                                                            |
| `SAPPORTA_API_PORT`              | Explicit app API port. Defaults to `3000` when neither port variable is set.                                                             |
| `PORT`                           | Hosting-platform API port used when `SAPPORTA_API_PORT` is absent.                                                                       |
| `LOG_FORMAT`                     | Set to `json` for structured logging.                                                                                                    |
| `LOG_LEVEL`                      | Log level. Default: `debug`.                                                                                                             |

## Sapporta Code Project Layout

A Sapporta code project (created by `sapporta init`) has this structure:

```
<project_root>/
  sapporta.json         Project marker (name, config)
  package.json          Dependencies (installed by sapporta init)
  data/
    sqlite.db           SQLite database
  packages/api/
    schema/             Table definitions (Drizzle + Sapporta wrapper)
    app/                App-owned API routes
    migrations/         Drizzle SQL migrations
```

## CLI Commands

The public CLI package is `sapporta`. `@sapporta/server` keeps the command implementation and also exposes a compatibility `sapporta` bin, but documentation should prefer `npx sapporta` or `npm install -g sapporta`.

### CLI Architecture

The CLI exposes resource-centered commands and routes all data commands through the HTTP API server. The CLI is a regular API consumer, not a privileged path.

**Requires a running server** (`pnpm dev` or `pnpm start` from the project) for API-backed commands. `init` works without a server.

### CLI Endpoint Discovery

Use `endpoints` to discover live HTTP endpoints and their input schemas:

```bash
# List all available HTTP endpoints
sapporta endpoints list

# Get full input schema (JSON Schema) for an endpoint
sapporta endpoints show "POST /api/meta/sql"
sapporta endpoints show "POST /api/tables/accounts"
```

### Global Flags

```bash
--output json     # Structured JSON output (auto-detected when stdout is not a TTY)
--output table    # Human-readable table output (default in terminal)
--api-url <url>   # One-off override for SAPPORTA_API_URL
--api-token <token> # One-off override for SAPPORTA_API_TOKEN
```

For API-backed data commands, set `SAPPORTA_API_URL` when the app API is not on `http://localhost:3000`. For protected apps, expose `SAPPORTA_API_TOKEN` to the agent or session. Use `--api-url` for one-off overrides; avoid passing raw tokens on the command line unless there is no safer option.

### Table Definition Commands

```bash
# List all tables with schema metadata and row counts
sapporta tables list
sapporta tables list --detail

# Show table structure (columns, types, constraints, foreign keys)
sapporta tables show <name>

# Show indexes on a table
sapporta tables indexes <name>

# Show sample rows from a table
sapporta tables sample <name> --limit 10 --columns name,type
```

### Database Commands

```bash
# Reads return rows
sapporta sql query "SELECT * FROM accounts"
sapporta sql query "SELECT * FROM accounts WHERE type = ?" --params '["asset"]' --limit 50

# Writes require the explicit execute command
sapporta sql execute "UPDATE accounts SET name = ? WHERE id = ?" --params '["Cash",5]'
sapporta sql execute "DELETE FROM accounts WHERE id = ?" --params '[5]' --dry-run
```

### Schema Migrations

Sapporta projects use native Drizzle Kit migrations directly:

```bash
pnpm --filter ./packages/api db:generate --name add_accounts
pnpm --filter ./packages/api db:migrate
pnpm --filter ./packages/api db:check
```

Each schema file should export the raw Drizzle table and the Sapporta wrapper:

```ts
export const accountsTable = sqliteTable("accounts", { ... });
export const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: { label: "Accounts", rowLabelColumns: ["name"] },
});
```

Change schema, run Drizzle Kit generate, review SQL, run Drizzle Kit migrate, start server. The server only verifies migration readiness at boot.

### Row Commands (table operations)

```bash
# List rows (with filters, sort, pagination)
sapporta rows list <table> --limit 50 --page 2 --sort "-created_at,name"
sapporta rows list <table> --where '{"status":{"eq":"active"}}'

# Get a single row by ID
sapporta rows get <table> <id>

# Create a single row
sapporta rows create <table> --values '{"name":"Cash","type":"asset"}'

# Create multiple rows (batch)
sapporta rows create <table> --values '[{"name":"Cash"},{"name":"Revenue"}]'

# Create master + detail records atomically
sapporta rows create orders --values '{"customer":"Alice","$details":{"table":"order_items","fk":"order_id","rows":[{"product":"Widget","quantity":3}]}}'

# Update a row
sapporta rows update <table> <id> --values '{"name":"Updated"}'

# Delete a row
sapporta rows delete <table> <id>
```

### Route-Based Reports

Reports are ordinary app routes that return `GridDataset` from
`@sapporta/shared/grid-dataset`. Use `sapporta endpoints` to inspect the route
contract and call the route like any other endpoint.

### Generic API Commands

```bash
sapporta api get /api/tables/books --query '{"limit":50}'
sapporta api post /api/custom-route --body '{"field":"value"}'
sapporta api put /api/custom-route/123 --body '{"field":"updated"}'
sapporta api delete /api/custom-route/123
```

## API Target

The CLI is a regular API client. API-backed commands call `http://localhost:3000` unless `SAPPORTA_API_URL` or `--api-url` selects another running app server.

## API Namespaces (Per-Project)

Framework routes are organized under `/api`; app-owned routes use whatever
paths the project registers:

```
/api/meta/...                          System metadata, introspection, admin
/api/tables/...                        Table operations on row data
/api/<app-route>                       App-owned routes, including reports
```

Each namespace has a distinct prefix — route ordering no longer matters.

### Key Route Details

- **Schema introspection**: `GET /api/meta/tables` — lists all tables with structure + UI metadata
- **Single table schema**: `GET /api/meta/tables/{name}` — one table's schema
- **DB introspection**: `GET /api/meta/tables/{name}/indexes`, `/api/meta/tables/{name}/sample`
- **SQL proxy**: `POST /api/meta/sql`
- **Table operations**: `GET/POST /api/tables/{table}`, `GET/PUT/DELETE /api/tables/{table}/{id}`
- **Lookup**: `GET /api/tables/{table}/_lookup`
- **Route-based reports**: app-owned contracts such as `GET /api/reports/trial-balance`

### Table Zod Boundaries

Use `tableApiZod` when composing a contract for generated table API values:

```ts
import { tableApiZod } from "@sapporta/server";

const insert = tableApiZod.forInsert(invoices, tables);
const patch = tableApiZod.forPatch(invoices, tables);
const response = z.object({ data: tableApiZod.forRow(invoices) });
```

`forInsert()` describes one caller-supplied row, not an array or a create
envelope. Generated routes compose arrays and master-detail bodies separately.
Columns with `apiWritable: false`, references with `apiSettable: false`,
generated primary keys, and auth-owned scope fields are excluded.

Use `tableWriteZod` for trusted values at the save boundary:

```ts
import { tableWriteZod } from "@sapporta/server";

const writeZod =
  operation === "insert"
    ? tableWriteZod.forInsert(invoices)
    : tableWriteZod.forPatch(invoices);
const result = writeZod.safeParse(record);
```

These schemas include server-authored structural columns. `parseTableWrite()`
adds application validation after structural parsing and returns the parsed,
canonical value that is passed to Drizzle. For one column's canonical value
behavior, use `zodForColumnValue(table, column)`; use
`getColumnEnumValues(column)` to read the column's Drizzle enum declaration.

## Core Modules

- **Table definition**: `sapportaTable()` in `src/schema/table.ts` wraps Drizzle `sqliteTable` with Sapporta metadata
- **Schema loading**: `loadSchemas()` dynamically imports all `.ts` files from a schema directory
- **Migrations**: native Drizzle Kit `generate` and `migrate`; Sapporta only checks readiness at boot
- **Meta API**: `mount-meta.ts` mounts schema introspection, DB introspection, and the SQL proxy
- **Tables API**: `tables-api.ts` — parametric `/:tableName` table-operation routing with runtime table registration
- **Selects**: declare allowed values once with `select("status", ["draft", "paid"] as const)`, or use Drizzle `text("status", { enum: [...] })` directly. The same column values drive validation, OpenAPI, and dropdown metadata.
- **Imports**: `@sapporta/server/table`, `@sapporta/server/runtime`, `@sapporta/server/view`, etc. (via package.json exports)

## Custom Views — Backend

Views are React components defined as `.tsx` files in the project's `views/` directory. Each file exports a `meta` object (for sidebar/routing) and a default React component (the screen itself).

```tsx
// views/dashboard.tsx
export const meta = {
  name: "dashboard",
  label: "Dashboard",
  icon: "layout-dashboard", // Lucide icon name, optional
};

export default function DashboardView() {
  return <div className="p-6">...</div>;
}
```

**Discovery:** The backend reads only `meta` for the API; the component runs in the browser.

**API endpoints:**

- `GET /views` — list views with metadata
- `GET /views/:name` — view metadata

**Action labels:** Actions can have an optional `label` property for display in the UI:

```ts
action({ name: "log_meal", label: "Log Meal", input: z.object({...}), run: ... })
```
