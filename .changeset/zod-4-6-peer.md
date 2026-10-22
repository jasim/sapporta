---
"@sapporta/server": patch
"@sapporta/frontend": patch
"@sapporta/honest": patch
"@sapporta/shared": patch
---

The packages now require zod 4.6.7 or later: their zod peer range is
`^4.6.7`, up from `^4.3.6`. Applications on an older zod 4 need to upgrade it.
