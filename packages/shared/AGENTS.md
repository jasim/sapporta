# @sapporta/shared — AI Instructions

## This is a leaf package

**`@sapporta/shared` MUST NOT depend on any other workspace package.** It sits at the bottom of the dependency graph so its consumers can import from it without creating cycles.

Its consumers are `@sapporta/server` (`packages/core`) on the backend, and `@sapporta/grid` and `@sapporta/frontend` in the browser. Shared depends on none of them. If you find yourself wanting to import from a consumer here, the abstraction belongs on the other side of the boundary, not in this package.

`@sapporta/ui` is a separate leaf: it does not depend on shared, and shared must not depend on it either.

## What belongs here

Types, ts-rest contracts, and pure helpers that would otherwise be re-declared on both sides of the client/server boundary and drift silently when one side changes:

- ts-rest contract definitions (`./contracts/*`) — the route data (`method`, `path`, Zod schemas) consumed by the server (`api.register(route, handler)`) and the client (`createApiClient(contract)`). Handler implementations live in core; only the contract data lives here.
- Wire-format grammars (e.g. the filter operator vocabulary, the URL/querystring shape the server parses).
- Shared value types used by both the API layer and the UI state (e.g. `FilterCondition`).
- Pure serializers / parsers for those shapes.

## What does NOT belong here

- Anything that imports React, Hono, Drizzle, better-sqlite3, or any other framework- or runtime-specific dependency.
- I/O, database access, HTTP handlers, React components.
- Project-specific domain code — that lives in the project's `src/app/`, not here.

## Root Barrel vs Subpaths

The root export (`@sapporta/shared`) barrels only pure value helpers:
filter grammar, query params, value kinds, dates, CSV, row ids, row
scopes, labels, counts, validation. The structural modules — `contracts`,
`grid-dataset`, `client` — are subpath-only by design: they are imported
deliberately at the few places that wire the API boundary, and keeping
them out of the barrel keeps casual root imports lightweight. Do not add
them to `src/index.ts`; do not add new grab-bag helpers as subpaths
without also deciding which side of this line they sit on.

## Constraints

- Pure TypeScript. No side effects at import time.
- `tsconfig.json` has `composite: true`; its consumers reference this package in their `tsconfig.json` `references`.
