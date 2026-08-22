---
"@sapporta/frontend": minor
---

A navigation item is active on its own page and on the pages nested under it.
The check was a plain prefix match, so an item pointing at `/` looked active
everywhere, and an item for `/orders` also lit up on `/orders-archive`.
