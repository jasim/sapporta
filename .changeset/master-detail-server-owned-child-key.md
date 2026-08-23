---
"@sapporta/server": patch
---

`/api/openapi.json` now renders for a master table whose child's foreign key is
server-owned. Declaring `meta.children` on the master and marking the child key
non-writable — either `references: { fk: { apiSettable: false } }` or
`columns: { fk: { apiWritable: false } }` — took down OpenAPI generation and
every consumer of it:

```
$ pnpm exec sapporta endpoints list
{"ok":false,"error":"Unrecognized key: \"meal_id\"","code":"INTERNAL"}
```

`createBodyZod()` omits the child key from the child insert schema to build the
master-with-`$details` branch, but `forInsert()` had already dropped it: a key
the API may not write is not in the insert shape to begin with. Zod 4 rejects an
`.omit()` mask naming an absent key, and does so from the lazy `shape` getter,
so the throw surfaced during JSON-schema conversion rather than at construction.
Row CRUD was unaffected — generated create and update routes set
`skipBodyValidation`, so the body schema is only read by OpenAPI and generated
clients.

`omitField()` now omits only a key the shape carries. The pairing is the
recommended one for a server-authored child key, and it is what turns a caller
who submits that key into an explicit `422` rather than a value the server
silently overwrites.
