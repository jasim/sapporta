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

CLI commands that hit the API auto-detect the project by walking up from `cwd` looking for `sapporta.json`. Use `--sapporta-project-dir <path>` to override, or set `SAPPORTA_API_URL` to point at a non-default host/port.

## Environment variables

| Variable | Purpose |
|---|---|
| `SAPPORTA_DEV_MODE_PACKAGE_ROOT` | Monorepo root. When set, `create-project` uses `link:` specs instead of published versions. Must be set explicitly — see DEVELOPMENT.md. |
| `SAPPORTA_PROJECT_DIR` | Resolved project directory. |
| `SAPPORTA_DATA_DIR` | Data directory. Default: `{projectDir}/data`. |
| `SAPPORTA_CODE_DIR` | Code directory. Default: `{projectDir}/code`. |
| `SAPPORTA_API_URL` | Server URL for CLI commands. Default: `http://localhost:3000`. |
| `SAPPORTA_OUTPUT_FORMAT` | Default CLI output format: `json` or `table`. |
| `PORT` | Server port. Default: `3000`. |
| `LOG_FORMAT` | Set to `json` for structured logging. |
| `LOG_LEVEL` | Log level. Default: `debug`. |

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
    reports/            Report definitions
    migrations/         Drizzle SQL migrations
```

## CLI Commands

The public CLI package is `sapporta`. `@sapporta/server` keeps the command implementation and also exposes a compatibility `sapporta` bin, but documentation should prefer `npx sapporta` or `npm install -g sapporta`.

### CLI Architecture

The CLI exposes resource-centered commands and routes all data commands through the HTTP API server. The CLI is a regular API consumer, not a privileged path.

**Requires a running server** (`pnpm dev` or `pnpm start` from the project) for all API commands, including project management (project list/add/remove). Local commands (init, check, describe) work without a server.

### CLI Self-Introspection

Use `describe` to discover live HTTP endpoints and their input schemas:

```bash
# List all available HTTP endpoints
sapporta describe

# Get full input schema (JSON Schema) for an endpoint
sapporta describe "POST /api/meta/sql"
sapporta describe "POST /api/tables/accounts"
```

### Global Flags

```bash
--output-format json   # Structured JSON output (auto-detected when stdout is not a TTY)
--output-format table  # Human-readable table output (default in terminal)
--input-body-json '{...}'  # JSON object to send as the request body for commands that accept one
```

### Table Definition Commands

```bash
# List all tables with schema metadata and row counts
sapporta tables

# Show table structure (columns, types, constraints, foreign keys)
sapporta tables show <name>

# Show indexes on a table
sapporta tables indexes <name>

# Show sample rows from a table
sapporta tables sample <name> --limit 10 --fields name,type

# Update table properties
sapporta tables update <name> --data '{"label":"New Label"}'

# Rename a table
sapporta tables update <name> --data '{"name":"new_name"}'

# Drop a UI-managed table
sapporta tables drop <name> --confirm true
```

### Enum and Database Commands

```bash
# List enum definitions
sapporta enums

# Run any SQL statement — reads return rows, writes report row counts
sapporta db exec-sql "SELECT * FROM accounts"
sapporta db exec-sql --input-body-json '{"sql": "SELECT * FROM accounts", "limit": 50}'
sapporta db exec-sql --input-body-json '{"sql": "DELETE FROM accounts WHERE id = 5"}'
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
export const accounts = table({ drizzle: accountsTable, meta: { label: "Accounts" } });
```

Change schema, run Drizzle Kit generate, review SQL, run Drizzle Kit migrate, start server. The server only verifies migration readiness at boot.

### Row Commands (CRUD operations)

```bash
# List rows (with filters, sort, pagination)
sapporta rows <table> --limit 50 --page 2 --sort name --order asc

# Get a single row by ID
sapporta rows get <table> <id>

# Insert a single row
sapporta rows insert <table> --data '{"name":"Cash","type":"asset"}'

# Insert multiple rows (batch)
sapporta rows insert <table> --data '[{"name":"Cash"},{"name":"Revenue"}]'

# Insert master + detail records atomically
sapporta rows insert orders --data '{"customer":"Alice","$details":{"table":"order_items","fk":"order_id","rows":[{"product":"Widget","quantity":3}]}}'

# Update a row
sapporta rows update <table> <id> --data '{"name":"Updated"}'

# Delete a row
sapporta rows delete <table> <id>
```

### Report Commands

```bash
# List all reports
sapporta reports

# Get report metadata
sapporta reports show <name>

# Execute a report with parameters
sapporta reports run <name> --year 2024 --month 1
```

### Action Commands

```bash
# List all actions
sapporta actions

# Execute an action
sapporta actions run <name> --data '{"field":"value"}'
```

### View Commands

```bash
# List all custom views
sapporta views
```

## Project Context

The CLI auto-detects the project by walking up from `cwd` looking for `sapporta.json` (created by `sapporta init`). Override with `--sapporta-project-dir <path>` when running from outside the project tree.

## API Namespaces (Per-Project)

Routes are organized into five namespaces per project under the prefix `/p/{slug}/api`:

```
/p/{slug}/api/meta/...                 System metadata, introspection, admin
/p/{slug}/api/tables/...               CRUD operations on table data
/p/{slug}/api/reports/...              Report listing and execution
/p/{slug}/api/actions/...              Transactional operations
/p/{slug}/api/views/...                Custom view metadata
```

Each namespace has a distinct prefix — route ordering no longer matters.

### Key Route Details

- **Schema introspection**: `GET /p/{slug}/api/meta/tables` — lists all tables with structure + UI metadata
- **Single table schema**: `GET /p/{slug}/api/meta/tables/{name}` — one table's schema
- **DB introspection**: `GET /p/{slug}/api/meta/tables/{name}/indexes`, `.../api/meta/tables/{name}/sample`
- **SQL proxy**: `POST /p/{slug}/api/meta/sql`
- **CRUD**: `GET/POST /p/{slug}/api/tables/{table}`, `GET/PUT/DELETE /p/{slug}/api/tables/{table}/{id}`
- **Lookup**: `GET /p/{slug}/api/tables/{table}/_lookup`
- **Reports**: `GET /p/{slug}/api/reports`, `GET /p/{slug}/api/reports/{name}/results?params`
- **Actions**: `GET /p/{slug}/api/actions`, `POST /p/{slug}/api/actions/{name}`
- **Views**: `GET /p/{slug}/api/views`

## Core Modules

- **Table definition**: `table()` in `src/schema/table.ts` wraps Drizzle `sqliteTable` with Sapporta metadata
- **Schema loading**: `loadSchemas()` dynamically imports all `.ts` files from a schema directory
- **Migrations**: native Drizzle Kit `generate` and `migrate`; Sapporta only checks readiness at boot
- **Meta API**: `mount-meta.ts` mounts schema introspection, DB introspection, and the SQL proxy
- **Tables API**: `tables-api.ts` — parametric `/:tableName` CRUD routing with runtime table registration
- **Actions API**: `action-api.ts` — single parametric `/:name` route with Map lookup
- **Enums**: SQLite has no native enum type. Use `text()` columns with `meta.selects` for dropdown/validation support.
- **Imports**: `@sapporta/server/table`, `@sapporta/server/runtime`, `@sapporta/server/view`, etc. (via package.json exports)

## Custom Views — Backend

Views are React components defined as `.tsx` files in the project's `views/` directory. Each file exports a `meta` object (for sidebar/routing) and a default React component (the screen itself).

```tsx
// views/dashboard.tsx
export const meta = {
  name: "dashboard",
  label: "Dashboard",
  icon: "layout-dashboard",  // Lucide icon name, optional
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
