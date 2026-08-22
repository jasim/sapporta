---
"@sapporta/frontend": minor
---

Signing in returns to the page the visitor asked for. `AuthGate` recorded that
page when it sent a visitor without a session to sign in, but nothing read it
back: the sign-in form and `PublicOnlyGate` always continued to `/`, so a
deep link opened by a signed-out visitor was lost.
