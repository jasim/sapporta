/**
 * Hono adapter for ts-rest.
 *
 * ts-rest ships Express/Fastify/Nest/Next adapters but nothing for Hono.
 * This package fills that gap: `TsRestApi` IS a Hono app with two extra
 * methods — `register` and `registerFamily` — that bind ts-rest
 * `AppRoute` objects to runtime handlers and a shared doc registry.
 *
 * ## The one-schema-two-uses flow
 *
 * A ts-rest `AppRoute` is pure data: method, path, and a Zod schema per
 * request part (pathParams/query/headers/body) plus one per response
 * status. That single object is used in exactly two places:
 *
 *   1. **OpenAPI emission** — `generateDocument()` walks every registered
 *      route's schemas through `z.toJSONSchema` and hands the result to
 *      `@sapporta/rest-open-api`.
 *
 *   2. **Request parsing** — at request time, `execute()` calls
 *      `route.pathParams.parse(c.req.param())`, `route.query.parse(...)`,
 *      etc., and hands the results to the handler as a typed
 *      `request: ServerInferRequest<typeof route>`. The handler does NOT
 *      re-parse — whatever's on `request.query` is already the declared
 *      type.
 *
 * Responses are different: the response Zod schema is **static-only**.
 * It types `ServerInferResponses<typeof route>` at author time and feeds
 * OpenAPI emission, but the adapter does not `.parse()` the handler's
 * body — response validation is too expensive for large list payloads
 * and wrong for non-JSON content like CSV.
 *
 * ## Worked example
 *
 *   const c = initContract();
 *   const listPresets = c.query({
 *     method: "GET",
 *     path: "/import-presets",
 *     query: z.object({ search: z.string().optional() }),
 *     responses: { 200: z.array(presetSchema) },
 *   });
 *
 *   const api = new TsRestApi();
 *   api.use(someMiddleware);          // normal Hono — `api` IS the Hono app
 *   api.register("listPresets", listPresets, async ({ c, request }) => {
 *     // request.query.search is `string | undefined` — already parsed.
 *     const rows = await loadPresets(request.query.search);
 *     return { status: 200, body: rows };
 *   });
 *   api.get("/healthz", (c) => c.text("ok"));   // plain, undocumented route
 *
 *   // Mount directly — TsRestApi IS a Hono instance:
 *   parentApp.route("/api", api);
 *   parentApp.get("/api/openapi.json", (c) =>
 *     c.json(api.generateDocument(undefined, { info: { title, version } })),
 *   );
 *
 * ## Registration modes
 *
 *   register(key, route, handler)
 *     Static path → one Hono route, one OpenAPI entry.
 *
 *   registerFamily({ method, genericPath, docs, dispatch, notFound })
 *     One generic Hono route (`/tables/:tableName`); `dispatch(c)` picks
 *     the concrete {route, handler} per request. Docs fan out into N
 *     concrete OpenAPI entries at generation time — useful for
 *     runtime-discovered resources where the route set isn't known at
 *     boot.
 */

import { Hono } from "hono";
import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type {
  AppRoute,
  AppRouter,
  ServerInferRequest,
  ServerInferResponses,
} from "@sapporta/rest-core";
import { generateOpenApi } from "@sapporta/rest-open-api";

export type MaybePromise<T> = T | Promise<T>;
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** Response content types the adapter serializes natively. */
export type ContentType = "application/json" | "text/csv" | "text/plain";

/**
 * Content-type-aware response send. The one place where JSON / CSV /
 * text routes diverge — everything above this function is uniform.
 */
export function sendBody(
  c: Context,
  body: unknown,
  status: ContentfulStatusCode,
  contentType: ContentType,
): Response {
  if (contentType === "application/json") return c.json(body as never, status);
  return c.body(body as string, status, { "Content-Type": contentType });
}

/**
 * Files uploaded via `multipart/form-data`, keyed by the form field name.
 *
 * Why this exists as a separate channel instead of living on `request.body`:
 * ts-rest's `ServerInferRequest` intentionally strips `File` / `File[]`
 * fields from the inferred body type when `contentType` is
 * `multipart/form-data` (see `BodyWithoutFileIfMultiPart` in
 * `@sapporta/rest-core`). That choice originated with the client — where file
 * fields are carried as `FormData` parts rather than in the parsed JSON —
 * and was applied to the server for symmetry. Consequently handlers cannot
 * see `request.body.file` at the type level even though the runtime value
 * is there. The official Express adapter works around this by exposing
 * `file` / `files` as separate `unknown` fields on the handler argument;
 * we do the same, typed as `Record<string, File | File[]>`.
 *
 * Empty object for non-multipart routes.
 */
export type UploadedFiles = Record<string, File | File[]>;

export type RouteHandler<R extends AppRoute, E extends Env = Env> = (args: {
  c: Context<E>;
  request: ServerInferRequest<R>;
  files: UploadedFiles;
}) => MaybePromise<ServerInferResponses<R> | Response>;

export interface ResolvedRoute<E extends Env> {
  route: AppRoute;
  handler: RouteHandler<AppRoute, E>;
}

export interface FamilyOptions<E extends Env, DocCtx> {
  method: HttpMethod;
  /** Hono-style generic path, e.g. `/tables/:tableName`. */
  genericPath: string;
  /**
   * Concrete ts-rest routes emitted at doc generation. Keys become
   * operation names; path+method must be unique across the full tree.
   */
  docs: (ctx: DocCtx) => Record<string, AppRoute>;
  /** Pick `{route, handler}` from the request, or return undefined. */
  dispatch: (c: Context<E>) => MaybePromise<ResolvedRoute<E> | undefined>;
  /** Default response when dispatch returns undefined. */
  notFound?: (c: Context<E>) => MaybePromise<Response>;
}

function isZodSchema(x: unknown): x is z.ZodType {
  return (
    !!x &&
    typeof x === "object" &&
    "parse" in x &&
    typeof (x as { parse?: unknown }).parse === "function"
  );
}

function parseMaybe(schema: unknown, value: unknown): unknown {
  return isZodSchema(schema) ? schema.parse(value) : value;
}

function responseContentType(route: AppRoute, status: number): ContentType {
  const res = (route.responses as Record<number, unknown>)[status];
  if (res && typeof res === "object" && "contentType" in res && "body" in res) {
    return (res as { contentType: string }).contentType as ContentType;
  }
  return "application/json";
}

async function execute<E extends Env>(
  c: Context<E>,
  route: AppRoute,
  handler: RouteHandler<AppRoute, E>,
): Promise<Response> {
  let request: ServerInferRequest<AppRoute>;
  const files: UploadedFiles = {};
  try {
    const params = parseMaybe(route.pathParams, c.req.param());
    const query = parseMaybe(route.query, c.req.query());
    const headers = parseMaybe(
      route.headers,
      Object.fromEntries(c.req.raw.headers),
    );
    const hasBody = "body" in route && isZodSchema(route.body);
    let body: unknown = undefined;
    if (hasBody) {
      const contentType = (route as { contentType?: string }).contentType;
      const isMultipart = contentType === "multipart/form-data";
      const isUrlEncoded = contentType === "application/x-www-form-urlencoded";
      let raw: unknown;
      try {
        // Hono's `parseBody({ all: true })` returns a flat
        // `{ [field]: string | File | (string | File)[] }` object for both
        // multipart and urlencoded. `{ all: true }` preserves repeated
        // fields as arrays, which matters for multi-file uploads.
        raw =
          isMultipart || isUrlEncoded
            ? await c.req.parseBody({ all: true })
            : await c.req.json();
      } catch (err) {
        if (err instanceof SyntaxError) {
          return c.json({ error: "Invalid JSON body", code: "BAD_JSON" }, 400);
        }
        throw err;
      }
      // Split File values off the multipart body onto the `files` channel
      // so the handler has a typed route to them. The ts-rest body type
      // strips File fields, so `request.body.file` is typed away even when
      // present at runtime. Body validation still runs against the full
      // payload (File fields included) so `z.instanceof(File)` in the
      // contract acts as a presence check.
      if (isMultipart && raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (v instanceof File) {
            files[k] = v;
          } else if (Array.isArray(v) && v.every((x) => x instanceof File)) {
            files[k] = v as File[];
          }
        }
      }
      const meta = (route as { metadata?: { skipBodyValidation?: boolean } })
        .metadata;
      if (meta?.skipBodyValidation) {
        // Author opted out — the handler owns validation and chooses the
        // canonical status code (e.g. 422 for CRUD rows).
        body = raw;
      } else {
        try {
          body = parseMaybe(route.body, raw);
        } catch (err) {
          if (err instanceof z.ZodError) {
            return c.json(
              {
                error: "Invalid request body",
                code: "BAD_REQUEST",
                details: err.issues,
              },
              400,
            );
          }
          throw err;
        }
      }
    }
    request = { params, query, headers, body } as ServerInferRequest<AppRoute>;
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json(
        { error: "Invalid request", code: "BAD_REQUEST", details: err.issues },
        400,
      );
    }
    throw err;
  }

  const result = await handler({ c, request, files });
  // Pragmatic escape hatch: handlers that need to return a raw `Response`
  // (streamed CSV, custom headers, etc.) can do so and we pass it through
  // untouched. The declared `{status, body}` shape is still enforced by
  // TypeScript on the author side; this only relaxes runtime.
  if (result instanceof Response) return result;
  const r = result as { status: number; body: unknown };
  return sendBody(
    c,
    r.body,
    r.status as ContentfulStatusCode,
    responseContentType(route, r.status),
  );
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

type DocEmitter<DocCtx> = (ctx: DocCtx) => Record<string, AppRoute>;

export interface ApiDoc {
  info: { title: string; version: string; description?: string };
  [key: string]: unknown;
}

export interface GenerateOptions {
  setOperationId?: boolean | "concatenated-path";
  jsonQuery?: boolean;
  /**
   * Prefix every emitted path with this string. When a `TsRestApi` is
   * mounted under a parent Hono route (e.g. `parentApp.route("/api", api)`),
   * the contracts still hold their raw paths (`/tables/:name`). Pass
   * `pathPrefix: "/api"` so the served spec reports the externally-visible
   * URL.
   */
  pathPrefix?: string;
}

/**
 * ts-rest 3.53's default transformer still delegates to `@anatine/zod-openapi`,
 * which peers Zod v3. Zod v4 ships its own JSON Schema emitter, so we plug
 * that in directly — zero v3 peer surface, and `.meta({ id })` component
 * ids survive into `$ref` form.
 */
const zodV4SchemaTransformer = ({ schema }: { schema: unknown }) => {
  if (
    schema &&
    typeof schema === "object" &&
    "_zod" in schema &&
    typeof (schema as { parse?: unknown }).parse === "function"
  ) {
    return z.toJSONSchema(schema as z.ZodType, {
      target: "openapi-3.0",
      unrepresentable: "any",
      io: "input",
    }) as never;
  }
  return null;
};

/**
 * `TsRestApi` IS a Hono app.
 *
 * Extending (rather than wrapping) keeps with Sapporta's "no opaque
 * boxes" rule: the user retains direct access to every Hono primitive —
 * `use`, `notFound`, `onError`, alternate routers passed to the
 * constructor, raw `get`/`post` for undocumented endpoints — and the
 * contract methods (`register`, `registerFamily`, `generateDocument`)
 * are additive, not gatekeepers.
 */
export class TsRestApi<E extends Env = Env, DocCtx = void> extends Hono<E> {
  private readonly runtimeKeys = new Set<string>();
  /**
   * Public (non-`#private`) for intentional reasons: cross-bundle reuse
   * needs duck-type access. When two copies of this class exist (e.g.
   * a host app and a compiled fixture loaded by a test runner),
   * `instanceof` fails, but both share the same `docEmitters` field
   * name. `extend()` below uses that to merge docs across the boundary.
   * Do not mutate from outside.
   */
  readonly docEmitters: DocEmitter<DocCtx>[] = [];

  register<R extends AppRoute>(
    operationId: string,
    route: R,
    handler: RouteHandler<R, E>,
  ): this {
    const key = routeKey(route.method, route.path);
    if (this.runtimeKeys.has(key)) {
      throw new Error(`ts-rest-hono: duplicate runtime route ${key}`);
    }
    this.runtimeKeys.add(key);
    const method = route.method.toLowerCase() as HttpMethod;
    this[method](route.path, (c) =>
      execute(c, route, handler as unknown as RouteHandler<AppRoute, E>),
    );
    this.docEmitters.push(() => ({ [operationId]: route }));
    return this;
  }

  registerFamily(opts: FamilyOptions<E, DocCtx>): this {
    const key = routeKey(opts.method, opts.genericPath);
    if (this.runtimeKeys.has(key)) {
      throw new Error(`ts-rest-hono: duplicate runtime route ${key}`);
    }
    this.runtimeKeys.add(key);
    this[opts.method](opts.genericPath, async (c) => {
      const resolved = await opts.dispatch(c);
      if (!resolved) {
        return opts.notFound
          ? await opts.notFound(c)
          : c.json({ error: "Not found", code: "NOT_FOUND" }, 404);
      }
      return execute(c, resolved.route, resolved.handler);
    });
    this.docEmitters.push(opts.docs);
    return this;
  }

  /**
   * Pull another `TsRestApi`'s doc emitters into this one, so this api's
   * `generateDocument()` spec includes the other's routes. Runtime routes
   * on `other` are served by `other`'s own Hono tree (mount it separately
   * via `parentApp.route(prefix, other)`). This is the decoupling point:
   * per-sub-app Hono autonomy, centralized spec emission.
   */
  extend(other: { docEmitters: readonly DocEmitter<unknown>[] }): this {
    for (const emit of other.docEmitters) {
      this.docEmitters.push(emit as DocEmitter<DocCtx>);
    }
    return this;
  }

  /**
   * Walk every registered route into a flat `AppRouter` object and defer
   * to `@sapporta/rest-open-api`. Path+method uniqueness is enforced; operation
   * keys are disambiguated by suffix if a family happens to reuse one.
   */
  generateDocument(
    ctx: DocCtx,
    apiDoc: ApiDoc,
    options?: GenerateOptions,
  ): ReturnType<typeof generateOpenApi> {
    const router: Record<string, AppRoute> = {};
    const seenPaths = new Set<string>();
    const prefix = options?.pathPrefix ?? "";
    for (const emit of this.docEmitters) {
      for (const [rawKey, route] of Object.entries(emit(ctx))) {
        const finalPath = prefix + route.path;
        const pk = routeKey(route.method, finalPath);
        if (seenPaths.has(pk)) {
          throw new Error(`ts-rest-hono: duplicate OpenAPI route ${pk}`);
        }
        seenPaths.add(pk);
        let name = rawKey;
        let i = 1;
        while (name in router) name = `${rawKey}_${i++}`;
        router[name] = prefix ? { ...route, path: finalPath } : route;
      }
    }
    const { pathPrefix: _pp, ...genOpts } = options ?? {};
    const doc = generateOpenApi(router as AppRouter, apiDoc, {
      schemaTransformer: zodV4SchemaTransformer,
      ...genOpts,
    }) as Record<string, unknown>;
    // `@sapporta/rest-open-api` emits `openapi: "3.0.2"`. We publish 3.1 specs
    // (the Zod-v4 transformer targets 3.0 schemas, which are a compatible
    // subset of 3.1). Downstream clients check for "3.1.0"; flip the
    // version bit without touching the rest of the doc.
    doc.openapi = "3.1.0";
    return doc as ReturnType<typeof generateOpenApi>;
  }
}
