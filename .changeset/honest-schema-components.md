---
"@sapporta/honest": patch
---

The served OpenAPI document's schema refs now resolve. `z.toJSONSchema` writes
a schema's shared parts as `definitions` beside it, with refs such as
`#/definitions/AccountsInsert` that point nowhere in an OpenAPI document, and
since zod 4.6 a request or response schema with a `.meta({ id })` became only
such a ref. `generateDocument()` now moves those definitions to
`components.schemas` and points the refs there: an id names its component, and
one id used for two different schemas throws; zod's generated names and a
recursive schema's root are named after the route. Parameter schemas stay
inline, so their parameters are still listed.
