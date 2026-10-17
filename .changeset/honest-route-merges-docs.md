---
"@sapporta/honest": patch
---

`TsRestApi.route()` now merges the docs of a mounted `TsRestApi` into the
parent's OpenAPI document, joining each contract path to the mount path the
way Hono does. Custom routes that a scaffolded app mounts in `loadApp()` with
`app.route("/", featureApi)` now appear in `/api/openapi.json` and in
`sapporta endpoints list`. A sub-api mounted at two paths is documented at
both. An app that calls both `route()` and `extend()` for the same sub-api
still lists each route once. `route()` rejects a sub-api whose doc context
differs from the parent's, as `extend()` does.
