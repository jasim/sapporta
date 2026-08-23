---
"@sapporta/server": patch
---

`scopedRows()` now returns properly typed rows for tables built with the
Sapporta column factories. Every factory took its column name as a plain
`string`, which threw away the name literal that Drizzle records on the column
builder. `TableRow` keys rows off that literal, so any column declared with
`text()`, `number()`, `select()`, `timestamp()`, `bool()`, `date()`, `money()`,
or `percentage()` collapsed into an index signature: reading `row.food_name`
gave `string | number | Instant | null` rather than `string | null`. Only
columns declared with Drizzle's own `integer()` kept their type.

The factories are now generic in the name, so the literal survives and each
column keeps its own type — including `select()`, which keeps its enum values
as a union. Nothing changes at runtime.

`columns.test.ts` asserts the row type of a table using all eight factories and
that the row type carries no index signature. These are `expectTypeOf`
assertions, so `pnpm typecheck` is what enforces them.
