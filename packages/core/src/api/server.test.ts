/**
 * Global JSON error handler on the root app. Every error branch returns
 * `{ error, code? }` as JSON so agent clients can parse failures uniformly.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createRequire } from "node:module";
import {
  installExactOriginCors,
  installFrameworkRoutePolicy,
  mountHealth,
  installSapportaDefaults,
  type SapportaEnv,
} from "./server.js";
import { normalizeHttpException } from "./http-exceptions.js";
import { OperationError } from "../errors.js";

type HonoHttpExceptionConstructor = new (
  status?: number,
  options?: { message?: string; res?: Response; cause?: unknown },
) => Error & {
  status: number;
  res?: Response;
  getResponse(): Response;
};

const require = createRequire(import.meta.url);
const { HTTPException: CjsHTTPException } =
  require("hono/http-exception") as unknown as {
    HTTPException: HonoHttpExceptionConstructor;
  };

function appThatThrows(err: unknown) {
  const app = installSapportaDefaults(new Hono<SapportaEnv>());
  app.get("/boom", () => {
    throw err;
  });
  return app;
}

describe("installSapportaDefaults", () => {
  it("returns JSON with code: INTERNAL for arbitrary thrown errors", async () => {
    const app = appThatThrows(
      new Error("NOT NULL constraint failed: x.created_at"),
    );
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      error: "NOT NULL constraint failed: x.created_at",
      code: "INTERNAL",
    });
  });

  it("classifies sqlite-style errors without leaking their raw code", async () => {
    const err = Object.assign(new Error("constraint failed"), {
      code: "SQLITE_CONSTRAINT_NOTNULL",
    });
    const res = await appThatThrows(err).request("/boom");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "constraint failed",
      code: "VALIDATION_FAILED",
    });
  });

  it("does not leak stack or cause on unhandled errors", async () => {
    const err = new Error("boom", { cause: new Error("root") });
    const res = await appThatThrows(err).request("/boom");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "boom", code: "INTERNAL" });
  });

  it("maps OperationError through ERROR_CODE_STATUS", async () => {
    const err = new OperationError("Table 'foo' not found", "TABLE_NOT_FOUND");
    const res = await appThatThrows(err).request("/boom");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Table 'foo' not found",
      code: "TABLE_NOT_FOUND",
    });
  });

  it("reshapes a bare HTTPException into a JSON envelope", async () => {
    const res = await appThatThrows(
      new HTTPException(409, { message: "Conflict" }),
    ).request("/boom");
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "Conflict" });
  });

  it("honors a structured JSON body attached via HTTPException res option", async () => {
    const err = new HTTPException(422, {
      res: Response.json(
        { error: "bad", code: "VALIDATION", hint: "fix it" },
        { status: 422 },
      ),
    });
    const res = await appThatThrows(err).request("/boom");
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      error: "bad",
      code: "VALIDATION",
      hint: "fix it",
    });
  });

  it("honors HTTPException responses from a different Hono module instance", async () => {
    const err = new CjsHTTPException(401, {
      res: Response.json(
        { error: "Project auth rejected", code: "unauthenticated" },
        { status: 401 },
      ),
    });
    expect(err).not.toBeInstanceOf(HTTPException);

    const res = await appThatThrows(err).request("/boom");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Project auth rejected",
      code: "unauthenticated",
    });
  });

  it("honors structurally equivalent Hono HTTPException responses", async () => {
    const response = Response.json(
      { error: "Sign in first", code: "unauthenticated" },
      { status: 401 },
    );
    const err = {
      message: "",
      status: 401,
      res: response,
      getResponse: () => response,
    };

    const normalized = normalizeHttpException(err);

    expect(normalized?.status).toBe(401);
    expect(await normalized?.response?.json()).toEqual({
      error: "Sign in first",
      code: "unauthenticated",
    });
  });

  it("reshapes a bare HTTPException from a different Hono module instance", async () => {
    const err = new CjsHTTPException(429, { message: "Slow down" });
    expect(err).not.toBeInstanceOf(HTTPException);

    const res = await appThatThrows(err).request("/boom");
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "Slow down" });
  });

  it("does not treat plain status/message errors as HTTP exceptions", async () => {
    const err = Object.assign(new Error("teapot"), { status: 418 });
    const res = await appThatThrows(err).request("/boom");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "teapot", code: "INTERNAL" });
  });

  it("returns JSON regardless of the client's Accept header", async () => {
    const res = await appThatThrows(new Error("boom")).request("/boom", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("framework route policy", () => {
  it("uses the project-supplied framework guard", async () => {
    const app = installSapportaDefaults(new Hono<SapportaEnv>());
    installFrameworkRoutePolicy(app, () => {
      throw new HTTPException(403, {
        res: Response.json(
          { error: "Project guard rejected" },
          { status: 403 },
        ),
      });
    });
    app.get("/api/meta/project", (c) => c.json({ ok: true }));

    const res = await app.request("/api/meta/project");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Project guard rejected" });
  });

  it("keeps project identity public", async () => {
    const app = installSapportaDefaults(new Hono<SapportaEnv>());
    installFrameworkRoutePolicy(app, () => {
      throw new HTTPException(403, {
        res: Response.json(
          { error: "Project guard rejected" },
          { status: 403 },
        ),
      });
    });
    app.get("/api/meta/info", (c) =>
      c.json({ name: "Acme Ledger", slug: "acme-ledger" }),
    );

    const res = await app.request("/api/meta/info");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Acme Ledger",
      slug: "acme-ledger",
    });
  });
});

describe("health policy", () => {
  it("returns a JSON 404 when health is disabled", async () => {
    const app = new Hono<SapportaEnv>();
    mountHealth(app, "disabled");

    const res = await app.request("/health");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("runs the authenticated health guard before returning ok", async () => {
    const app = new Hono<SapportaEnv>();
    mountHealth(app, "authenticated", () => {
      throw new HTTPException(401, {
        res: Response.json({ error: "Sign in first" }, { status: 401 }),
      });
    });

    const res = await app.request("/health");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in first" });
  });
});

describe("CORS", () => {
  it("rejects wildcard origins for credentialed CORS", () => {
    expect(() =>
      installExactOriginCors(new Hono<SapportaEnv>(), {
        credentials: true,
        origins: ["*"],
      }),
    ).toThrow(/wildcard origins/);
  });

  it("does not reflect unconfigured origins for credentialed CORS", async () => {
    const app = new Hono<SapportaEnv>();
    installExactOriginCors(app, { credentials: true });
    app.get("/cors", (c) => c.json({ ok: true }));

    const res = await app.request("/cors", {
      headers: { Origin: "https://example.com" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
