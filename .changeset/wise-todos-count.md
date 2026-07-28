---
"@sapporta/server": minor
"@sapporta/shared": minor
"@sapporta/frontend": minor
---

Generalize deterministic, row-scoped table counts through
`GET /api/tables/<table>/_count` and `sapporta rows count`.

Counts support canonical typed filters, bounded grouping, deterministic order,
typed group values, and explicit total or grouped result shapes. Foreign-key
labels remain a separate lookup operation with their own authorization boundary.
