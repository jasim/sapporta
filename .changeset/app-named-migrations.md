---
"@sapporta/server": minor
---

An app can keep its Drizzle migrations in a directory it names, and can apply
them from its own code, for example at startup. `assertMigrationsReady` and
`loadSapportaProject` take `migrationsDir`, which defaults to
`packages/api/migrations` under the project root as before.
`pendingMigrations(sqlite, migrationsDir)` lists the migrations the database
has not applied, and `applyMigrations(sqlite, migrationsDir)` applies them with
drizzle-orm's `migrate()` and returns the ones it applied. It throws, and
applies nothing, when a pending migration is dated before the latest applied
one, because `migrate()` would skip that migration without an error.

