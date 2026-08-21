---
"@sapporta/server": minor
---

`loadSapportaProject` now runs auth schema validation itself, after the
structural checks and before search plans compile. Previously the boot
template called `assertAuthSchemaDefinitions` after loading the project,
which was too late: search-plan compilation resolves the same reference
metadata and failed on the first reference problem, hiding the aggregated
"Auth schema validation failed" report. The generated `boot.ts` no longer
needs its own call; existing projects that still call
`assertAuthSchemaDefinitions` keep working — the check is simply redundant
there now.
