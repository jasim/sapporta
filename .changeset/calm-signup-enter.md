---
"@sapporta/frontend": patch
---

Let the server's email verification policy decide access after sign-up. The
auth store no longer treats every unverified email as a blocked session; it
relies on the `email_not_verified` failure the API returns when verification
is required. Sign-up now enters the app directly when the server started a
session, and shows the verify-email page only when it did not. In development,
where verification is not required by default, new users land in the app
without clicking the emailed link.
