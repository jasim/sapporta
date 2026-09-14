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
`pnpm dev` and `pnpm seed` load that file. The `pnpm db:*` scripts do not,
because the same scripts run in development and on a server. They read
`SAPPORTA_DATA_DIR` from the environment, however it got there (the shell, a
tool such as mise or direnv, or a deployment's settings), and stop when it is
not set. Due to this, forgetting the setting stops a migration instead of
running it against whatever database a file names. In development, pass the
value explicitly, for example
`SAPPORTA_DATA_DIR=data pnpm --filter ./packages/api db:migrate`. The Docker
image sets `SAPPORTA_DATA_DIR=/app/data`, and other deployments set it in the
server's environment.

To make a wrong value visible, the server prints the path of the database it
opened when it starts. When startup stops because migrations are not ready,
the error names the database it checked.

`@sapporta/server` exports `databasePath()` and `dataPath(...segments)`.
Application code can use `dataPath()` for its own files that belong with the
database, for example `dataPath("user-config", "import-presets.json")`.
`drizzle.config.ts` imports `databasePath()` from `@sapporta/server/data-dir`,
which has no dependencies beyond Node itself.

`fromProjectRoot()` no longer returns `dataDir` or `databasePath`, and
`projectRootFromDbPath()` and `storeDbPath()` are removed. `storeDbPath()`
built `<store>/<project>/data/sqlite.db`, a location the data directory no
longer follows.

An existing project makes the same changes as a new one:

- Add `SAPPORTA_DATA_DIR=data` to `.env.development`.
- Call `databasePath()` in `packages/api/runtime.ts` and
  `packages/api/drizzle.config.ts`, and print `databasePath` from
  `packages/api/boot.ts` when the server is ready.
- Add `ENV SAPPORTA_DATA_DIR=/app/data` to the `Dockerfile` before the line
  that creates `/app/data`. Without it, a rebuilt image stops at its migration
  step on every start.
- Set `SAPPORTA_DATA_DIR` in the environment of every other deployment, and
  wherever `pnpm db:*` scripts run, including CI.
