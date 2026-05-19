import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Env, Hono } from "hono";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
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
 *      retrieved via `c.get(k)`. loadSapporta()'s middleware sets `db`
 *      and `sqlite` so user route handlers can read them with full
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
  };
}

type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500;

function statusForCode(code: string): HttpErrorStatus {
  return (ERROR_CODE_STATUS[code] ?? 500) as HttpErrorStatus;
}

/**
 * Install Sapporta's default middleware, health endpoint, and error handler
 * on a Hono app.
 *
 * The template's `boot.ts` does `new Hono<SapportaEnv>()` itself and calls
 * this before `loadSapporta(...)`. `load-sapporta.ts` also calls it so
 * tests don't have to.
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
  app.use("*", requestLogger());
  app.use("*", cors());

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.onError((err, c) => {
    const log = logger.child({ module: "http" });

    if (err instanceof HTTPException) {
      if (err.res) return err.res;
      return c.json({ error: err.message }, err.status);
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
