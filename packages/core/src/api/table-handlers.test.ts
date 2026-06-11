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
import { table } from "../schema/table.js";
import { createTestDb } from "../testing/test-utils.js";
import { createRoute } from "./table-contracts.js";
import { makeAuthorizedTableHandlers } from "./table-handlers.js";
import type { SapportaEnv } from "./server.js";

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

const orders = table({
  drizzle: ordersTable,
  meta: { rowScope: "workspaceGlobal" },
});

const orderLines = table({
  drizzle: orderLinesTable,
  meta: { rowScope: "workspaceGlobal" },
});

describe("makeAuthorizedTableHandlers", () => {
  it("requires create permission on master-detail child tables", async () => {
    const { sqlite, db } = createTestDb();
    try {
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

      const catalog = createTableCatalog([orders, orderLines]);
      const workspace = {
        id: "workspace-1",
        name: "Workspace One",
        slug: "workspace-one",
      };
      const auth = createAuthContext<SapportaAbility>({
        principal: {
          kind: "user",
          user: {
            id: "user-1",
            name: "User One",
            email: "user-1@example.test",
            emailVerified: true,
          },
          membership: {
            id: "member-1",
            roles: ["member"],
          },
        },
        dataAuthority: requestDataAuthority({
          systemGlobalOnly: systemGlobalOnlyAuthority(),
          workspaceGlobalOnly: workspaceGlobalOnlyAuthority(workspace),
        }),
        ability: createOnlyOrdersAbility(),
        catalog,
      });
      const handlers = makeAuthorizedTableHandlers(catalog, db, {
        guard: () => auth,
      });
      const route = createRoute(orders, catalog.tables);
      const createOrders = handlers.create({
        def: orders,
        route,
        tables: catalog.tables,
      });
      const app = new Hono<SapportaEnv>();
      app.post("/orders", async (c) => {
        const result = await createOrders({
          c,
          request: {} as Parameters<typeof createOrders>[0]["request"],
          files: {},
        });
        if (result instanceof Response) return result;
        if (!isRouteResponse(result)) {
          throw new Error("Expected table create route response.");
        }
        return Response.json(result.body, { status: result.status });
      });

      const response = await app.request("/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Expense report",
          $details: {
            table: "order_lines",
            fk: "order_id",
            rows: [{ description: "Taxi" }],
          },
        }),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Forbidden",
        code: "forbidden",
      });
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM orders").get()).toEqual({
        count: 0,
      });
      expect(
        sqlite.prepare("SELECT COUNT(*) AS count FROM order_lines").get(),
      ).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});

function createOnlyOrdersAbility(): SapportaAbility {
  return {
    can(action, subject) {
      return action === "create" && subject === "orders";
    },
  };
}

function isRouteResponse(
  value: unknown,
): value is { status: number; body: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "number" &&
    "body" in value
  );
}
