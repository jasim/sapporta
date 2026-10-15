---
"@sapporta/honest": patch
---

`TsRestApi.route()` now merges the docs of a mounted `TsRestApi` into the
parent's OpenAPI document, with the mount path prepended to each contract
path. Custom routes that a scaffolded app mounts in `loadApp()` with
`app.route("/", featureApi)` now appear in `/api/openapi.json` and in
`sapporta endpoints list`. `extend()` is now idempotent, so an app that
calls both `route()` and `extend()` for the same sub-api still lists each
route once.
