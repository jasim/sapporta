/**
 * Global JSON error handler on the root app. Every error branch returns
 * `{ error, code? }` as JSON so agent clients can parse failures uniformly.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  installExactOriginCors,
  installFrameworkRoutePolicy,
  installSapportaDefaults,
  type SapportaEnv,
} from "./server.js";
import { OperationError } from "../introspect/types.js";

function appThatThrows(err: unknown) {
  const app = installSapportaDefaults(new Hono<SapportaEnv>());
  app.get("/boom", () => {
    throw err;
  });
  return app;
}

describe("installSapportaDefaults", () => {
  it("returns JSON with code: INTERNAL for arbitrary thrown errors", async () => {
    const app = appThatThrows(new Error("NOT NULL constraint failed: x.created_at"));
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({
      error: "NOT NULL constraint failed: x.created_at",
      code: "INTERNAL",
    });
  });

  it("preserves a sqlite-style error.code on the JSON body", async () => {
    const err = Object.assign(new Error("constraint failed"), { code: "SQLITE_CONSTRAINT_NOTNULL" });
    const res = await appThatThrows(err).request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "constraint failed", code: "SQLITE_CONSTRAINT_NOTNULL" });
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
    expect(await res.json()).toEqual({ error: "Table 'foo' not found", code: "TABLE_NOT_FOUND" });
  });

  it("reshapes a bare HTTPException into a JSON envelope", async () => {
    const res = await appThatThrows(new HTTPException(409, { message: "Conflict" })).request("/boom");
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "Conflict" });
  });

  it("honors a structured JSON body attached via HTTPException res option", async () => {
    const err = new HTTPException(422, {
      res: Response.json({ error: "bad", code: "VALIDATION", hint: "fix it" }, { status: 422 }),
    });
    const res = await appThatThrows(err).request("/boom");
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "bad", code: "VALIDATION", hint: "fix it" });
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
        res: Response.json({ error: "Project guard rejected" }, { status: 403 }),
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
        res: Response.json({ error: "Project guard rejected" }, { status: 403 }),
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
