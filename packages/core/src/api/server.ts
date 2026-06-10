import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Context, Env, Hono } from "hono";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import type { SapportaAuthContext } from "../auth/index.js";
import { logger, requestLogger } from "../db/logger.js";
import { OperationError } from "../introspect/types.js";
import { ERROR_CODE_STATUS } from "./error-codes.js";

/**
 * Hono `Env` shape used by every Sapporta-managed app and sub-app.
 *
 * Extends Hono's own `Env` (re-exported from `hono`) — the base type
 * defines the `Bindings` / `Variables` slots that the framework reads.
 * Sapporta only customizes `Variables`; `Bindings` is inherited from
 * the base (Sapporta runs on Node and uses no platform bindings).
 *
 *   - `Variables` — request-scoped values set via `c.set(k, v)` and
 *      retrieved via `c.get(k)`. installSapportaRequestContext() sets
 *      `db` and `sqlite` so user route handlers can read them with full
 *      type inference (no `any` casts on the Context).
 *
 * Threading this through `Hono<SapportaEnv>` (or `TsRestApi<SapportaEnv>`)
 * everywhere is what makes `c.get("db")` resolve to `BetterSQLite3Database`
 * in user code.
 */
export interface SapportaEnv extends Env {
  Variables: {
    db: BetterSQLite3Database;
    sqlite: Database.Database;
    auth: SapportaAuthContext;
  };
}

type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500;

function statusForCode(code: string): HttpErrorStatus {
  return (ERROR_CODE_STATUS[code] ?? 500) as HttpErrorStatus;
}

export function installRequestLogging<E extends SapportaEnv>(app: Hono<E>): Hono<E> {
  app.use("*", requestLogger());
  return app;
}

export interface ExactOriginCorsOptions {
  origins?: readonly string[];
  sameOrigin?: boolean;
  credentials?: boolean;
}

export function installExactOriginCors<E extends SapportaEnv>(
  app: Hono<E>,
  options: ExactOriginCorsOptions = {},
): Hono<E> {
  if (options.credentials === true && options.origins?.includes("*")) {
    throw new Error("Credentialed CORS requires exact origins; wildcard origins are not allowed.");
  }

  app.use(
    "*",
    cors({
      credentials: options.credentials,
      origin: (origin) => {
        if (!origin) return options.sameOrigin === true ? "" : origin;
        if (!options.origins || options.origins.length === 0) {
          return options.credentials === true ? "" : origin;
        }
        return options.origins.includes(origin) ? origin : "";
      },
    }),
  );
  return app;
}

export type HealthPolicy = "disabled" | "public" | "authenticated";
export type SapportaAuthGuard<E extends SapportaEnv = SapportaEnv> = (
  c: Context<E>,
) => SapportaAuthContext;
export type SapportaHealthGuard<E extends SapportaEnv = SapportaEnv> = (
  c: Context<E>,
) => unknown | Promise<unknown>;

export function mountHealth<E extends SapportaEnv>(
  app: Hono<E>,
  policy: HealthPolicy = "public",
  guard?: SapportaHealthGuard<E>,
): Hono<E> {
  if (policy === "disabled") {
    app.get("/health", (c) => c.json({ error: "Not found" }, 404));
    return app;
  }
  if (policy === "authenticated") {
    if (!guard) {
      throw new Error("Authenticated health policy requires a project auth guard.");
    }
    app.use("/health", async (c, next) => {
      await guard(c);
      return next();
    });
  }
  app.get("/health", (c) => c.json({ status: "ok" }));
  return app;
}

export function installSapportaErrorHandler<E extends SapportaEnv>(app: Hono<E>): Hono<E> {
  app.onError((err, c) => {
    const log = logger.child({ module: "http" });

    const httpException = httpExceptionLike(err);
    if (httpException) {
      if (httpException.res) return httpException.res;
      return c.json({ error: httpException.message }, httpException.status);
    }

    if (err instanceof OperationError) {
      return c.json({ error: err.message, code: err.code }, statusForCode(err.code));
    }

    log.error("unhandled request error", {
      method: c.req.method,
      path: c.req.path,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? "INTERNAL";
    return c.json({ error: message, code }, 500);
  });

  return app;
}

type HttpExceptionLike = {
  status: HttpErrorStatus;
  message: string;
  res?: Response;
};

function httpExceptionLike(err: unknown): HttpExceptionLike | null {
  if (err instanceof HTTPException) {
    return {
      status: httpErrorStatusFromNumber(err.status),
      message: err.message,
      res: err.res,
    };
  }
  if (typeof err !== "object" || err === null) return null;
  const candidate = err as {
    status?: unknown;
    message?: unknown;
    res?: unknown;
    getResponse?: unknown;
  };
  const response =
    responseLike(candidate.res) ??
    (typeof candidate.getResponse === "function"
      ? responseLike(candidate.getResponse())
      : null);
  if (response) {
    return {
      status: httpErrorStatusFromNumber(response.status),
      message:
        typeof candidate.message === "string" ? candidate.message : "",
      res: response,
    };
  }
  if (
    typeof candidate.status === "number" &&
    isHttpErrorStatus(candidate.status) &&
    typeof candidate.message === "string"
  ) {
    return { status: candidate.status, message: candidate.message };
  }
  return null;
}

function httpErrorStatusFromNumber(status: number): HttpErrorStatus {
  return isHttpErrorStatus(status) ? status : 500;
}

function isHttpErrorStatus(status: number): status is HttpErrorStatus {
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 422 ||
    status === 500
  );
}

function responseLike(value: unknown): Response | null {
  if (value instanceof Response) return value;
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as {
    status?: unknown;
    headers?: unknown;
    clone?: unknown;
    text?: unknown;
  };
  if (
    typeof candidate.status === "number" &&
    typeof candidate.headers === "object" &&
    typeof candidate.clone === "function" &&
    typeof candidate.text === "function"
  ) {
    return value as Response;
  }
  return null;
}

export function installFrameworkRoutePolicy<E extends SapportaEnv>(
  app: Hono<E>,
  guard: SapportaAuthGuard<E>,
): Hono<E> {
  const currentAuthOnly = async (c: Context<E>, next: () => Promise<void>) => {
    guard(c);
    return next();
  };
  const currentAuthOnlyMeta = async (c: Context<E>, next: () => Promise<void>) => {
    if (c.req.method === "GET" && c.req.path === "/api/meta/info") {
      return next();
    }
    guard(c);
    return next();
  };
  app.use("/api/openapi.json", currentAuthOnly);
  app.use("/api/meta/*", currentAuthOnlyMeta);
  app.use("/api/reports/*", currentAuthOnly);
  return app;
}

/**
 * Install Sapporta's default middleware, health endpoint, and error handler
 * on a Hono app.
 *
 * Projects own their entry point and choose whether to call this bundled helper
 * or wire the individual primitives themselves before mounting routes.
 *
 *   - `requestLogger()` / CORS — always-on concerns for an HTTP app.
 *   - `GET /health` — liveness probe outside every project scope.
 *   - `onError` — translates `HTTPException` / `OperationError` / unknown
 *     errors into a `{ error, code? }` JSON envelope so an API or agent
 *     client can always parse a response body.
 */
export function installSapportaDefaults<E extends SapportaEnv>(
  app: Hono<E>,
): Hono<E> {
  installRequestLogging(app);
  installExactOriginCors(app);
  mountHealth(app, "public");
  installSapportaErrorHandler(app);
  return app;
}
