---
"@sapporta/server": patch
---

`sapporta init` now requires pnpm 11 or later and fails with a clear message on
older versions. The generated project keeps its workspace settings in
`pnpm-workspace.yaml`, which pnpm 10 and earlier ignore, and its root
package.json no longer carries a `pnpm` field that pnpm 11 would ignore.

Source-linked scaffolds write their dependency overrides into
`pnpm-workspace.yaml` as well; pnpm 11 dropped support for the `pnpm` field in
the root package.json, so those overrides were silently inert. The override set
also gains `kysely` and `@types/better-sqlite3`: both are optional peers of
drizzle-orm, so a version drift between the generated project and the linked
checkout split drizzle-orm into two package identities and every drizzle type
into two incompatible declarations.
