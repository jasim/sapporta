---
"@sapporta/grid": minor
---

Remove the `@sapporta/grid/grid` subpath export. It exposed the same
surface as the root export, differing only in the root's stylesheet side
effect, so the package had two names for one module. Import from
`@sapporta/grid` instead; the stylesheet can still be loaded separately
via `@sapporta/grid/index.css`.
