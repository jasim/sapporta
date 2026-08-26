# @sapporta/shared

Types, API contracts, and pure helpers shared by `@sapporta/server` on the backend and `@sapporta/grid` and `@sapporta/frontend` in the browser.

`@sapporta/shared` is a leaf package in the Sapporta monorepo. It is safe to use from browser and server code, and it must not import from any other workspace package.

## Installation

```bash
npm install @sapporta/shared
```

```bash
pnpm add @sapporta/shared
```

## What It Exports

### Contracts

`@sapporta/shared/contracts` contains the Zod schemas, wire-shape types, and ts-rest route contracts used by the Sapporta server and UI.

```ts
import {
  uiContract,
  lookupQuerySchema,
  DEFAULT_LOOKUP_LIMIT,
  MAX_LOOKUP_LIMIT,
  MAX_LOOKUP_IDS,
  type TableSchema,
  type Row,
} from "@sapporta/shared/contracts";
```

Table list contracts coerce `page` and `limit` query strings into bounded
numbers. Lookup contracts keep ID and search modes separate: ID mode accepts a
non-empty comma-separated list capped by `MAX_LOOKUP_IDS`, while search mode
defaults to `DEFAULT_LOOKUP_LIMIT` and is capped by `MAX_LOOKUP_LIMIT`.

### Typed Client Helpers

`@sapporta/shared/client` provides a thin ts-rest client wrapper and the shared API error type.

```ts
import { createApiClient, ApiError } from "@sapporta/shared/client";
import { uiContract } from "@sapporta/shared/contracts";

const client = createApiClient(uiContract, {
  baseUrl: () => "http://localhost:3000/api",
});
```

### Filters

`@sapporta/shared/filter` owns Sapporta's table filter grammar and serialization helpers.

```ts
import {
  encodeFilters,
  decodeFilters,
  type FilterCondition,
} from "@sapporta/shared/filter";
```

### Temporal Helpers

`@sapporta/shared/temporal` contains date/time parsing and serialization helpers used consistently across server validation and UI editing.

```ts
import {
  parseCanonicalInstant,
  parsePlainDate,
} from "@sapporta/shared/temporal";
```

### Other Utilities

The package also exposes helpers for value kinds, date ranges, and record IDs:

```ts
import type { ValueKind } from "@sapporta/shared/value-kind";
import { toRecordId, type RecordId } from "@sapporta/shared/record-id";
import { allTime, relative, custom } from "@sapporta/shared/daterange";
```

## Package Boundaries

This package is intentionally pure:

- No dependency on any other workspace package
- No Node-only APIs in exported contract/client modules
- No framework-specific runtime assumptions

That boundary lets Sapporta keep one source of truth for API contracts and data shapes while allowing projects to compose or replace the server and frontend pieces independently.

## License

MIT
