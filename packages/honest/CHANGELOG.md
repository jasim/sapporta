# @sapporta/honest

## 0.3.18

### Patch Changes

- 293284b: `TsRestApi.route()` now merges the docs of a mounted `TsRestApi` into the
  parent's OpenAPI document, joining each contract path to the mount path the
  way Hono does. Custom routes that a scaffolded app mounts in `loadApp()` with
  `app.route("/", featureApi)` now appear in `/api/openapi.json` and in
  `sapporta endpoints list`. A sub-api mounted at two paths is documented at
  both. An app that calls both `route()` and `extend()` for the same sub-api
  still lists each route once. `route()` rejects a sub-api whose doc context
  differs from the parent's, as `extend()` does.
- 33e6dc2: The served OpenAPI document's schema refs now resolve. `z.toJSONSchema` writes
  a schema's shared parts as `definitions` beside it, with refs such as
  `#/definitions/AccountsInsert` that point nowhere in an OpenAPI document, and
  since zod 4.6 a request or response schema with a `.meta({ id })` became only
  such a ref. `generateDocument()` now moves those definitions to
  `components.schemas` and points the refs there: an id names its component, and
  one id used for two different schemas throws; zod's generated names and a
  recursive schema's root are named after the route. Parameter schemas stay
  inline, so their parameters are still listed.
- 33e6dc2: The packages now require zod 4.6.7 or later: their zod peer range is
  `^4.6.7`, up from `^4.3.6`. Applications on an older zod 4 need to upgrade it.

## 0.3.17

### Patch Changes

- af9df0d: A request with an empty body now reaches the contract's body schema as
  `undefined` instead of failing with 400 `BAD_JSON`. A DELETE sent without a
  payload to a route whose body is optional, such as
  `body: z.object({}).optional()`, now succeeds, and a route whose body is
  required answers with the 400 `BAD_REQUEST` validation error. Malformed JSON
  still answers with `BAD_JSON`.

## 0.3.16

### Patch Changes

- Grid updates and new release

## 0.3.15

### Patch Changes

- Release

## 0.3.14

### Patch Changes

- release

## 0.3.13

### Patch Changes

- Release

## 0.3.12

### Patch Changes

- release

## 0.3.11

### Patch Changes

- Improve port management of new projects

## 0.3.10

### Patch Changes

- Improvements after comparing agentic build of sample projects

## 0.3.9

### Patch Changes

- Add column width resize separators in reports, page titles for each page

## 0.3.8

### Patch Changes

- Add drill-down links to reports

## 0.3.7

### Patch Changes

- Release coinciding with updated homepage design

## 0.3.6

### Patch Changes

- Internal testing release

## 0.3.5

### Patch Changes

- Release for homepage deployment pre-checks

## 0.3.4

### Patch Changes

- first iteration of auth integration

## 0.3.3

### Patch Changes

- Create Dockerfile based deployment

## 0.3.2

### Patch Changes

- Update sapporta cli install

## 0.3.1

### Patch Changes

- Publish the current Honest adapter release with the rest of Sapporta.

## 0.3.0

Initial public release of `@sapporta/honest` from the cleaned public repository history.
