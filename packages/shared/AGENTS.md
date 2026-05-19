# @sapporta/shared — AI Instructions

## This is a leaf package

**`@sapporta/shared` MUST NOT depend on `@sapporta/server` (`packages/core`) or `@sapporta/ui` (`packages/ui`).** It sits below both of them in the dependency graph so they can import from it without creating cycles.

Both core and ui may depend on shared. Shared depends on neither. If you find yourself wanting to import from core or ui here, the abstraction belongs on the other side of the boundary, not in this package.

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

## Constraints

- Pure TypeScript. No side effects at import time.
- `tsconfig.json` has `composite: true`; core and ui reference this package in their `tsconfig.json` `references`.
