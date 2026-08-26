# @sapporta/server

The server half of [Sapporta](https://sapporta.com): schema-as-code tables, the
HTTP surface generated from them, row-level security, and the `sapporta` CLI.

Full documentation is at [sapporta.com/docs](https://sapporta.com/docs).

## Table declaration to REST APIs + Row Security

In a Sapporta project, a table is declared once, as an ordinary Drizzle table 
plus Sapporta metadata. This package uses them to provide the following:

- **REST endpoints** for list, get, create, update, delete, lookup, scoped
  counts, and streaming CSV export, under `/api/tables/<table>`.
- **Row security.** Every generated read and write is bounded by the signed-in
  user's workspace and row scope, and the same bound is available to custom
  code through `scopedRows()`.
- **Schema metadata** — labels, value kinds, relationships, search
  configuration — served over `/api/meta` and consumed by the generated grids,
  forms, and lookups in `@sapporta/frontend`.
- **OpenAPI and CLI access.** Mounted routes are emitted as OpenAPI 3.1 and are
  callable from `sapporta` on the command line, so a person or a coding agent
  can inspect and drive a running app without reading its source.

Custom endpoints are registered beside the generated ones and share the same
auth context, row helpers, and OpenAPI document.

## Install

Most projects arrive here through the scaffold rather than a direct install:

```bash
npx sapporta init my-app
```

Requires Node.js and pnpm 11 or later — a generated project keeps its workspace
settings in `pnpm-workspace.yaml`, which earlier pnpm versions ignore, so
`sapporta init` checks the installed version before writing anything.

Adding the package to a project by hand means supplying its peers as well —
`@sapporta/honest` and `@sapporta/rest-core` — plus the stack a backend needs
directly: `hono`, `drizzle-orm`, `better-sqlite3`, and `zod`. A scaffolded
project's `packages/api/package.json` is the worked example of that dependency
set.

## The shape of the code

A schema file exports the raw Drizzle table and the Sapporta wrapper:

```ts
import {
  integer,
  select,
  sqliteTable,
  sapportaTable,
  text,
} from "@sapporta/server/table";

export const invoicesTable = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  reference: text("reference").notNull(),
  status: select("status", ["draft", "paid"] as const).notNull(),
});

export const invoices = sapportaTable({
  drizzle: invoicesTable,
  meta: { label: "Invoices", rowLabelColumns: ["reference"] },
});
```

That is enough for the generated endpoints and UI. A custom endpoint reads the
same table through `scopedRows()`, which takes the request database handle, the
authenticated auth context, and one table definition, and returns row
operations bounded by the caller's row scope:

```ts
import { eq } from "drizzle-orm";
import { scopedRows } from "@sapporta/server";
import { invoices, invoicesTable } from "../schema/invoices.js";

api.register("listPaidInvoices", contract.listPaidInvoices, async ({ c }) => {
  const auth = projectAuth.requireWorkspaceUser(c);
  const rows = scopedRows(c.get("db"), auth, invoices);

  const paid = await rows.findMany({
    where: eq(invoicesTable.status, "paid"),
    limit: 50,
  });

  return { status: 200, body: { data: paid } };
});
```

The `where` and `orderBy` arguments are ordinary Drizzle expressions. The row
scope is added to them before the query reaches SQLite, so a handler cannot
widen its own visibility by accident.

Alongside `findMany()`, `scopedRows()` provides paged reads, an async cursor for
large sequential scans, typed lookups, and scalar and grouped counts. See
[Row-scoped data helpers](https://sapporta.com/docs/reference/server/row-scoped-data-helpers)
for the complete surface and its bounds.

## Modules

Each row is a package export subpath.

| Module                  | Purpose                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `.`                     | Runtime surface for `boot.ts` and endpoint code: project loading and mounting, middleware, `scopedRows`, auth      |
| `./table`               | Column builders and the `sapportaTable` wrapper used by schema files                                               |
| `./errors`              | Error vocabulary: `ErrorCode`, `OperationError`, validation and query-parse errors, SQLite error classification    |
| `./testing`             | `createTestDb` and `createTestConnection` — in-memory SQLite with production PRAGMA settings                       |
| `./create-project`      | Programmatic project creation, the engine behind `sapporta init`                                                   |
| `./source-link-runtime` | Node module-resolution preload used when developing against Sapporta sources rather than published packages        |
| `./cli`                 | The `sapporta` command, plus `./cli/commands`, `./cli/client`, `./cli/http-client`, `./cli/format`, `./cli/render` |

For every exported symbol and its exact declaration, read the generated
[API reference](https://sapporta.com/api-reference/index.md) rather than the
declaration files under `node_modules` — it names the specifier to import from,
which a file path does not.

## Documentation

- [Documentation](https://sapporta.com/docs) — index of guides and reference
- [Tables, columns, and schema metadata](https://sapporta.com/docs/guides/model-data/tables-columns-and-schema-metadata) — what a declaration controls
- [Schema changes and migrations](https://sapporta.com/docs/guides/model-data/schema-changes-and-migrations) — Drizzle Kit generate, review, migrate
- [Auth and row security](https://sapporta.com/docs/reference/server/auth-and-row-security) — row scopes, abilities, trusted fields, guards
- [Table endpoints](https://sapporta.com/docs/reference/http/table-endpoints) — the generated HTTP surface
- [Custom API endpoints](https://sapporta.com/docs/guides/application-code/custom-api-endpoints) — registering a protected domain route
- [Use the Sapporta CLI](https://sapporta.com/docs/guides/discovery/use-the-sapporta-cli) — inspecting and driving a running app
- [Environment variables](https://sapporta.com/docs/reference/project/environment-variables) — supported server, build, and CLI settings

## Contributing

This package lives in the
[Sapporta monorepo](https://github.com/jasim/sapporta). See `DEVELOPMENT.md` for
the build and test commands, and `ARCHITECTURE.md` for the package roster, the
module index of each package, and the dependency rules between them.

Note that `src/templates/` is the project scaffold — the files `sapporta init`
copies into a generated project. `src/vendored-package-snapshots/` holds
package.json snapshots used to resolve scaffold dependency versions. 

## License

MIT
