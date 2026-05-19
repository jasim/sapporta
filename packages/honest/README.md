# @sapporta/honest

**Honest** is the [Hono](https://hono.dev/) + [ts-rest](https://ts-rest.com/) adapter. ts-rest ships official adapters for Express, Fastify, Nest, and Next, but nothing for Hono — Honest fills that gap. One ts-rest `AppRoute` drives both request parsing and OpenAPI doc emission, and a `registerFamily` primitive lets one generic Hono route resolve per-request to any of N concrete routes (useful when the route set isn't known at boot).

```ts
import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { TsRestApi } from "@sapporta/honest";

const c = initContract();

const listPresets = c.query({
  method: "GET",
  path: "/import-presets",
  query: z.object({ search: z.string().optional() }),
  responses: {
    200: z.array(z.object({ id: z.string(), name: z.string() })),
  },
});

const api = new TsRestApi();

api.register("listPresets", listPresets, async ({ request }) => {
  // request.query.search is already parsed: `string | undefined`
  const rows = await loadPresets(request.query.search);
  return { status: 200, body: rows };
});

api.get("/healthz", (c) => c.text("ok")); // plain Hono still works

// TsRestApi IS a Hono instance — mount it directly.
const parent = new Hono();
parent.route("/api", api);
parent.get("/api/openapi.json", (c) =>
  c.json(api.generateDocument(undefined, { info: { title: "My API", version: "1.0.0" } })),
);
```

## What it is

`TsRestApi` extends `Hono`. Two extra methods — `register` and `registerFamily` — bind ts-rest `AppRoute` objects to runtime handlers and, simultaneously, register them in a doc emitter list. `generateDocument()` walks that list through `@sapporta/rest-open-api` and returns an OpenAPI 3.1 JSON document.

The one-schema-two-uses flow is the point:

1. **Request parsing.** At request time, the adapter calls `route.pathParams.parse(c.req.param())`, `route.query.parse(...)`, `route.body.parse(...)`, etc., and hands the handler a typed `request: ServerInferRequest<typeof route>`. The handler does NOT re-parse — values on `request.query` / `request.body` are already the declared type.
2. **OpenAPI emission.** The same schemas are walked via `z.toJSONSchema` and handed to `@sapporta/rest-open-api` to produce the served spec.

Response schemas, by contrast, are **static-only** — they type `ServerInferResponses<typeof route>` at author time and feed doc emission, but the adapter does not `.parse()` the handler's body. Response validation is too expensive for large list payloads and wrong for non-JSON content like CSV.

## What's different from the official ts-rest adapters

- **Hono-native, not framework-agnostic.** `TsRestApi` extends `Hono<E>` directly, so the user keeps full access to every Hono primitive — `use`, `notFound`, `onError`, middleware, env typing, raw `get`/`post` for undocumented endpoints. The contract methods are additive, never gatekeepers.
- **Zod v4 JSON Schema transformer.** ts-rest 3.53's default transformer delegates to `@anatine/zod-openapi`, which peers Zod v3. Honest plugs `z.toJSONSchema` in directly, so `.meta({ id })` component ids survive into `$ref` form and there's zero Zod v3 peer surface.
- **`registerFamily` — one generic route, N concrete doc entries.** When you have a generic path like `/tables/:tableName` and don't know the table set at boot (runtime-discovered resources, plugin-contributed endpoints, per-tenant schemas), one Hono route is mounted, and a `dispatch(c)` callback picks the concrete `{route, handler}` per request. Docs fan out into N concrete OpenAPI entries at generation time.

```ts
api.registerFamily({
  method: "get",
  genericPath: "/tables/:tableName",
  // At doc-generation time, emit one concrete route per table.
  docs: (ctx) => Object.fromEntries(ctx.tables.map((t) => [`list_${t.name}`, listRoute(t)])),
  // At request time, resolve to the concrete route for THIS table.
  dispatch: (c) => {
    const table = resolver.get(c.req.param("tableName"));
    if (!table) return undefined;
    return { route: listRoute(table), handler: buildListHandler(table) };
  },
});
```

If you've hit the wall where "I want one route but N doc entries with different schemas" in other OpenAPI tooling — that's the wall this solves.

## Installation

```bash
npm install @sapporta/honest @sapporta/rest-core hono zod
# or
pnpm add @sapporta/honest @sapporta/rest-core hono zod
```

`@sapporta/rest-core`, `hono`, and `zod` are peer dependencies — bring your own (sapporta-rest 3.52+, Hono 4+, Zod 4+). `@sapporta/rest-open-api` is a direct dependency (internal to doc generation).

## API

### `TsRestApi<E, DocCtx>`

Extends `Hono<E>`. `E` is the Hono env generic (`Variables` / `Bindings`). `DocCtx` is the context object passed to `docs(ctx)` in `registerFamily` calls and to `generateDocument(ctx, ...)` at emission time — use it for whatever the concrete routes need at doc time (table registry, tenant list, plugin manifest).

```ts
api.register(operationId, route, handler);               // static route
api.registerFamily({ method, genericPath, docs, dispatch, notFound }); // dynamic
api.extend(otherApi);                                     // merge another api's doc emitters
api.generateDocument(ctx, apiDoc, options?);              // OpenAPI 3.1 JSON
```

### `register(operationId, route, handler)`

Bind a ts-rest `AppRoute` to a Hono route and a handler. The operationId becomes the OpenAPI `operationId`. Handlers receive `{ c, request }` and return `{ status, body }` (or a raw `Response` as an escape hatch for streamed / custom-header responses). Duplicate `METHOD path` combinations throw at registration time.

### `registerFamily({ method, genericPath, docs, dispatch, notFound })`

One Hono route, many OpenAPI entries. `genericPath` is Hono-style (`/tables/:tableName`). `docs(ctx)` returns `Record<operationId, AppRoute>` at doc-generation time. `dispatch(c)` returns `{ route, handler }` at request time, or `undefined` to fall through to `notFound` (defaults to `404 NOT_FOUND`).

### `extend(other)`

Pull another `TsRestApi`'s doc emitters into this one so the merged spec includes the other's routes. Runtime routes on `other` are served by `other`'s own Hono tree — mount it separately via `parent.route(prefix, other)`. This is the decoupling point: per-sub-app Hono autonomy, centralized spec emission. `other` just needs a `docEmitters` array, so cross-bundle reuse (e.g. compiled fixtures loaded by a test runner) works via duck typing.

### `generateDocument(ctx, apiDoc, options?)`

Walks every registered route into a flat `AppRouter` object and defers to `@sapporta/rest-open-api`. Returns the OpenAPI 3.1 JSON document. `options.pathPrefix` prefixes every path in the emitted spec — use it when the api is mounted under a parent Hono route, so the served spec reports the externally-visible URL.

### `errorBodySchema` / `ErrorBody`

The shared `{ error, code?, details? }` Zod schema (with OpenAPI component id `"ErrorBody"`) that the adapter emits for built-in failures. Re-exported so consumers can reuse it in their own response schemas and share the component across the spec.

## Built-in error envelopes

Honest emits a few well-known errors directly (before the handler is called):

| Status | Code | When |
|--------|------|------|
| 400 | `BAD_REQUEST` | Request failed Zod validation. `details` carries `ZodIssue[]`. |
| 400 | `BAD_JSON` | Request body wasn't valid JSON. |
| 404 | `NOT_FOUND` | `registerFamily` dispatch resolved to `undefined` and no `notFound` was provided. |

All match `errorBodySchema`. Handler-thrown exceptions are **not** caught — they bubble to the Hono app's `onError`, where the host can shape its global error response.

### Opting out of body validation

A route can set `metadata: { skipBodyValidation: true }` to bypass the adapter's body parse — the raw JSON lands in `request.body` and the handler owns validation. This is useful when the handler needs to choose a non-`400` status for body errors (e.g. `422` for CRUD row validation).

## Status

Early. Extracted from the [Sapporta](https://github.com/jasim/sapporta) monorepo where it drives the framework's table / meta / reports namespaces. API may shift between 0.x releases.

## License

MIT
