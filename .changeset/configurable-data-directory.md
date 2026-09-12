---
"@sapporta/server": minor
---

The SQLite database of a Sapporta app is now located by the
`SAPPORTA_DATA_DIR` environment variable. Until now it was always
`data/sqlite.db` under the project root, so one project could not run against
two databases. For example, a developer could not keep sample data separate
from real data, and a host could not run one process per customer with a
database for each.

In this change, we make `SAPPORTA_DATA_DIR` the only way to locate the
database. The value is the directory that holds `sqlite.db`, given either as an
absolute path or as a path relative to the project root (the directory with
`sapporta.json`). A relative path is never resolved against the working
directory, so `data` names the same directory for `pnpm dev`, Drizzle Kit, and
the built server, even though each of them starts in a different directory.

There is no default. The server and Drizzle Kit both stop with an error when
the variable is missing. Due to this, a process that was started without the
setting cannot open some other database. For example, `pnpm db:migrate` cannot
migrate `data/sqlite.db` while `pnpm dev` runs on a different directory.

`sapporta init` writes `SAPPORTA_DATA_DIR=data` into `.env.development`.
Because the path is relative, copying a project directory also copies its
database, and the copy opens its own database instead of the original's.
`pnpm dev`, `pnpm seed`, and now every `pnpm db:*` script load that file, so
all of them open the same database. To switch databases in development, change
the path in that file. The Docker image sets `SAPPORTA_DATA_DIR=/app/data`.
Other deployments set it in the server's environment and run
`drizzle-kit migrate` directly in that same environment, because
`pnpm db:migrate` loads `.env.development`.

`@sapporta/server` exports `databasePath()` and `dataPath(...segments)`.
Application code can use `dataPath()` for its own files that belong with the
database, for example `dataPath("user-config", "import-presets.json")`.
`drizzle.config.ts` imports `databasePath()` from `@sapporta/server/data-dir`,
which has no dependencies beyond Node itself.

`fromProjectRoot()` no longer returns `dataDir` or `databasePath`, and
`projectRootFromDbPath()` is removed. An existing project makes the same
changes as a new one: add `SAPPORTA_DATA_DIR=data` to `.env.development`, call
`databasePath()` in `packages/api/runtime.ts` and
`packages/api/drizzle.config.ts`, and prefix each `db:*` script in
`packages/api/package.json` with
`node --env-file=../../.env.development node_modules/drizzle-kit/bin.cjs`.
