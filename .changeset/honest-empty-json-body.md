---
"@sapporta/honest": patch
---

A request with an empty body now reaches the contract's body schema as
`undefined` instead of failing with 400 `BAD_JSON`. A DELETE sent without a
payload to a route whose body is optional, such as
`body: z.object({}).optional()`, now succeeds, and a route whose body is
required answers with the 400 `BAD_REQUEST` validation error. Malformed JSON
still answers with `BAD_JSON`.
