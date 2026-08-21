---
"@sapporta/server": minor
---

Consolidate the error vocabulary into the `@sapporta/server/errors`
module. `ErrorCode`, `ErrorCodeValue`, and `OperationError` — previously
internal to an introspection types file — now live alongside
`ValidationError`, `QueryParseError`, and SQLite error classification in
the one errors module. Existing imports from `@sapporta/server/errors`
and the root export are unchanged; the module simply exposes the full
vocabulary now.
