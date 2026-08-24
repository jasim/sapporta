import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  createAuthContext,
  requestDataAuthority,
  systemGlobalOnlyAuthority,
  type SapportaAbility,
  workspaceGlobalOnlyAuthority,
} from "../auth/index.js";
import { createTableCatalog } from "../schema/catalog.js";
import { sapportaTable } from "../schema/table.js";
import { createTestDb } from "../testing/test-utils.js";
import { createRoute } from "./table-api-contracts.js";
import { makeAuthorizedTableHandlers } from "./table-handlers.js";
import type { SapportaEnv } from "./server.js";
import { parseTimeZone } from "@sapporta/shared/temporal";

const ordersTable = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  workspace_id: text("workspace_id").notNull(),
});
const orderLinesTable = sqliteTable("order_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  order_id: integer("order_id")
    .notNull()
    .references(() => ordersTable.id),
  description: text("description").notNull(),
  workspace_id: text("workspace_id").notNull(),
});

const orders = sapportaTable({
  drizzle: ordersTable,
  meta: {
    rowScope: "workspaceGlobal",
    rowLabelColumns: ["label"],
    children: [{ table: "order_lines", foreignKey: "order_id" }],
  },
});

function lines(guarded: boolean) {
  return sapportaTable({
    drizzle: orderLinesTable,
    meta: {
      rowScope: "workspaceGlobal",
      rowLabelColumns: ["description"],
      references: guarded
        ? { order_id: { table: "orders", apiSettable: false } }
        : { order_id: { table: "orders" } },
    },
  });
}

function buildApp(guarded: boolean) {
  const { sqlite, db } = createTestDb();
  sqlite.exec(`
    CREATE TABLE orders (
      id integer PRIMARY KEY AUTOINCREMENT,
      label text NOT NULL,
      workspace_id text NOT NULL
    );
    CREATE TABLE order_lines (
      id integer PRIMARY KEY AUTOINCREMENT,
      order_id integer NOT NULL REFERENCES orders(id),
      description text NOT NULL,
      workspace_id text NOT NULL
    );
  `);
  const catalog = createTableCatalog([orders, lines(guarded)]);
  const workspace = {
    id: "workspace-1",
    name: "W",
    slug: "w",
    timeZone: parseTimeZone("UTC"),
  };
  const auth = createAuthContext<SapportaAbility>({
    principal: {
      kind: "user",
      user: { id: "u1", name: "U", email: "u@e.test", emailVerified: true },
      membership: { id: "m1", roles: ["member"] },
    },
    dataAuthority: requestDataAuthority({
      systemGlobalOnly: systemGlobalOnlyAuthority(),
      workspaceGlobalOnly: workspaceGlobalOnlyAuthority(workspace),
    }),
    ability: { can: () => true },
    catalog,
  });
  const handlers = makeAuthorizedTableHandlers(catalog, db, {
    guard: () => auth,
  });
  const createOrders = handlers.create({
    def: orders,
    route: createRoute(orders, catalog.tables),
    tables: catalog.tables,
  });
  const app = new Hono<SapportaEnv>();
  app.post("/orders", async (c) => {
    const body: unknown = await c.req.json();
    const result = await createOrders({
      c,
      request: { body } as Parameters<typeof createOrders>[0]["request"],
      files: {},
    });
    if (result instanceof Response) return result;
    const r = result as { status: number; body: unknown };
    return Response.json(r.body, { status: r.status });
  });
  return { app, sqlite };
}

const payload = (extra: Record<string, unknown>) => ({
  label: "Order A",
  $details: {
    table: "order_lines",
    fk: "order_id",
    rows: [{ description: "Taxi", ...extra }],
  },
});

/**
 * The child foreign key is server-authored: `handleMasterDetailCreate` passes
 * the created master key through `serverValues`. Whether a caller who submits
 * that key anyway is told so depends on the child's reference metadata, and
 * the difference is the whole value of declaring `apiSettable: false` on a
 * master-detail child. Documented in the `$details` contract under
 * `reference/http/table-endpoints`.
 */
describe("a $details row that carries the server-authored child FK", () => {
  it("is rejected when the child reference is not API-settable", async () => {
    const { app, sqlite } = buildApp(true);
    try {
      const res = await app.request("/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload({ order_id: 999 })),
      });

      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({
        code: "VALIDATION_FAILED",
        details: [{ field: "order_id" }],
      });
      expect(
        sqlite.prepare("SELECT COUNT(*) AS count FROM orders").get(),
      ).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it("is overwritten by the master key when the reference is settable", async () => {
    const { app, sqlite } = buildApp(false);
    try {
      const res = await app.request("/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload({ order_id: 999 })),
      });

      expect(res.status).toBe(201);
      const master = sqlite.prepare("SELECT id FROM orders").get() as {
        id: number;
      };
      expect(sqlite.prepare("SELECT order_id FROM order_lines").all()).toEqual([
        { order_id: master.id },
      ]);
    } finally {
      sqlite.close();
    }
  });
});
