---
"@sapporta/server": patch
---

Source-linked scaffolds now write their dependency overrides into
`pnpm-workspace.yaml`, where pnpm 10+ actually reads them; the `pnpm`
field in the root package.json was silently ignored. The override set
also gains `kysely` and `@types/better-sqlite3`: both are optional peers
of drizzle-orm, so a version drift between the generated project and the
linked checkout split drizzle-orm into two package identities and every
drizzle type into two incompatible declarations.
