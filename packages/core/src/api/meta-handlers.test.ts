import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SapportaAuthContext } from "../auth/index.js";
import { createTableCatalog } from "../schema/catalog.js";
import { sapportaTable } from "../schema/table.js";
import type { TableDef } from "../schema/table.js";
import { createTestDb } from "../testing/test-utils.js";
import {
  installSapportaDefaults,
  type SapportaAuthGuard,
  type SapportaEnv,
} from "./server.js";
import { makeMetaHandlers } from "./meta-handlers.js";
import { mountMeta } from "./mount-meta.js";
import { TsRestApi } from "./index.js";

const camelRowsTable = sqliteTable("camel_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
  workspaceId: text("workspace_id").notNull(),
  createdAt: text("created_at").notNull(),
});

const camelRows = sapportaTable({
  drizzle: camelRowsTable,
  meta: {
    label: "Camel Rows",
    rowScope: "workspaceGlobal",
    rowLabelColumns: ["display_name"],
  },
});

describe("makeMetaHandlers", () => {
  it("requires auth inside getTable when meta is mounted directly", async () => {
    const { app, close } = createMetaApp((): SapportaAuthContext => {
      throw new HTTPException(401, {
        res: Response.json({ error: "Auth required" }, { status: 401 }),
      });
    });

    try {
      const res = await app.request("/api/meta/tables/camel_rows");

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Auth required" });
    } finally {
      close();
    }
  });
});

function createMetaApp(
  guard: SapportaAuthGuard,
): { app: Hono<SapportaEnv>; close: () => void } {
  const { sqlite, db } = createTestDb();
  sqlite.exec(`
    CREATE TABLE camel_rows (
      id integer PRIMARY KEY AUTOINCREMENT,
      display_name text NOT NULL,
      workspace_id text NOT NULL,
      created_at text NOT NULL
    );
    INSERT INTO camel_rows (display_name, workspace_id, created_at)
    VALUES ('Visible', 'workspace-1', '2026-06-25');
    INSERT INTO camel_rows (display_name, workspace_id, created_at)
    VALUES ('Hidden', 'workspace-2', '2026-06-25');
  `);
  const catalog = createTableCatalog([camelRows]);
  const app = installSapportaDefaults(new Hono<SapportaEnv>());
  const api = new TsRestApi<SapportaEnv, { tables: readonly TableDef[] }>();

  mountMeta(
    api,
    makeMetaHandlers(
      catalog,
      sqlite,
      db,
      { dir: "", name: "Test", slug: "test" },
      { requireAuthContext: guard },
    ),
  );
  app.route("/api", api);

  return { app, close: () => sqlite.close() };
}
