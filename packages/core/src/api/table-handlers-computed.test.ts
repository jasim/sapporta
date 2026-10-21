/**
 * The `computed` parameter on the generated table API: every row read
 * returns the requested fields' values in a side map, computes them with
 * one loader run per request, and fails as a whole when a field cannot be
 * computed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { RecordId } from "@sapporta/shared/record-id";
import { TsRestApi } from "@sapporta/honest";
import { createTableCatalog } from "../schema/catalog.js";
import { extractSchemas } from "../schema/extract.js";
import type { ComputedBatch } from "../schema/computed-field.js";
import { computedField, sapportaTable, treePath } from "../schema/table.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import { mountTables, type TablesDocContext } from "./mount-tables.js";
import type { SapportaEnv } from "./server.js";
import { makeAuthorizedTableHandlers } from "./table-handlers.js";

const itemsTable = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  description: text("description").notNull(),
  parent_id: integer("parent_id").references(
    (): AnySQLiteColumn => itemsTable.id,
  ),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
});

const runs: string[] = [];
let failing = false;

// Both onHand and stockLine read this, once per request.
function onHand(batch: ComputedBatch): Promise<Map<RecordId, number>> {
  return batch.once("onHand", async () => {
    runs.push(`onHand:${batch.ids.join(",")}`);
    return new Map(batch.ids.map((id) => [id, Number(id) * 10]));
  });
}

const items = sapportaTable({
  drizzle: itemsTable,
  meta: {
    rowLabelColumns: ["description"],
    tree: { parentColumn: "parent_id" },
    rowCaption: "stockLine",
  },
  computed: {
    onHand: computedField({
      kind: "number",
      notes: "Units in stock.",
      schema: z.number(),
      load: onHand,
    }),
    stockLine: computedField({
      kind: "text",
      load: async (batch) => {
        const values = await onHand(batch);
        return new Map(
          batch.ids.map((id) => [id, `${String(values.get(id))} in stock`]),
        );
      },
    }),
    broken: computedField({
      kind: "number",
      load: ({ ids }): Map<RecordId, number> => {
        if (failing) throw new Error("stock service is down");
        return new Map(ids.map((id) => [id, 0]));
      },
    }),
    parentPath: treePath(),
  },
});

let api: TsRestApi<SapportaEnv, TablesDocContext>;
let add: (description: string, parent?: number) => number;

beforeEach(() => {
  runs.length = 0;
  failing = false;
  const { sqlite, db } = createTestDb();
  sqlite.exec(`
    CREATE TABLE items (
      id integer PRIMARY KEY AUTOINCREMENT,
      description text NOT NULL,
      parent_id integer REFERENCES items(id),
      workspace_id text NOT NULL,
      scoped_to_user_id text NOT NULL
    );
  `);
  const insert = sqlite.prepare(
    "INSERT INTO items (description, parent_id, workspace_id, scoped_to_user_id) VALUES (?, ?, 'workspace-1', 'user-1')",
  );
  add = (description, parent) =>
    Number(insert.run(description, parent ?? null).lastInsertRowid);
  const catalog = createTableCatalog([items]);
  const auth = createTestAuthContext({ tables: [items] });
  api = new TsRestApi<SapportaEnv, TablesDocContext>();
  mountTables(
    api,
    catalog,
    makeAuthorizedTableHandlers(catalog, db, { guard: () => auth }),
  );
});

async function getJson(path: string) {
  const res = await api.request(path);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function send(method: "POST" | "PUT", path: string, body: unknown) {
  const res = await api.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("computed fields over HTTP", () => {
  it("returns nothing extra when no field is named", async () => {
    add("Bolt");
    const { status, body } = await getJson("/tables/items");
    expect(status).toBe(200);
    expect(body).not.toHaveProperty("computed");
    expect(runs).toEqual([]);
  });

  it("computes a page's fields with one loader run", async () => {
    const a = add("Bolt");
    const b = add("Nut");
    const { status, body } = await getJson(
      "/tables/items?computed=stockLine,onHand",
    );
    expect(status).toBe(200);
    expect(body.computed).toEqual({
      stockLine: { [a]: "10 in stock", [b]: "20 in stock" },
      onHand: { [a]: 10, [b]: 20 },
    });
    expect(runs).toEqual([`onHand:${a},${b}`]);
  });

  it("computes the rows of a tree read and of a child level", async () => {
    const parts = add("Parts");
    const bolt = add("Bolt", parts);
    add("Washer");

    const tree = await getJson(
      "/tables/items?q=bolt&tree=ancestors&computed=parentPath",
    );
    expect(tree.status).toBe(200);
    expect(tree.body.computed).toEqual({
      parentPath: { [parts]: null, [bolt]: "Parts" },
    });

    const child = await getJson(
      `/tables/items?fixed[parent_id][eq]=${parts}&computed=onHand`,
    );
    expect(child.body.computed).toEqual({ onHand: { [bolt]: bolt * 10 } });
  });

  it("computes the row of a single-row read", async () => {
    const id = add("Bolt");
    const { body } = await getJson(`/tables/items/${id}?computed=onHand`);
    expect(body.computed).toEqual({ onHand: { [id]: id * 10 } });
  });

  it("computes lookup entries, by ids and by search", async () => {
    const a = add("Bolt");
    const b = add("Nut");

    const byIds = await getJson(
      `/tables/items/_lookup?ids=${a},${b}&computed=stockLine`,
    );
    expect(byIds.status).toBe(200);
    expect(byIds.body.computed).toEqual({
      stockLine: { [a]: "10 in stock", [b]: "20 in stock" },
    });

    runs.length = 0;
    const search = await getJson("/tables/items/_lookup?q=nu&computed=onHand");
    expect(search.body.computed).toEqual({ onHand: { [b]: 20 } });
    expect(runs).toEqual([`onHand:${b}`]);
  });

  it("computes nothing on create and update", async () => {
    // A write commits before anything could be computed, so a failing
    // loader must not turn a saved row into an error.
    failing = true;
    const created = await send("POST", "/tables/items?computed=broken", {
      description: "Bolt",
    });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("computed");
    const id = (created.body.data as { id: number }).id;

    const updated = await send("PUT", `/tables/items/${id}?computed=broken`, {
      description: "Hex bolt",
    });
    expect(updated.status).toBe(200);
    expect(updated.body).not.toHaveProperty("computed");
  });

  it("rejects an unknown name with 400", async () => {
    const id = add("Bolt");
    for (const path of [
      "/tables/items?computed=nope",
      `/tables/items/${id}?computed=nope`,
      `/tables/items/_lookup?ids=${id}&computed=nope`,
    ]) {
      const { status, body } = await getJson(path);
      expect(status, path).toBe(400);
      expect(body.code).toBe("unknown_computed_field");
      expect(String(body.error)).toContain("onHand, stockLine");
    }
  });

  it("fails the whole read when one field fails", async () => {
    add("Bolt");
    failing = true;
    const res = await api.request("/tables/items?computed=onHand,broken");
    expect(res.status).toBe(500);
  });

  it("advertises the fields and the caption in the table schema", () => {
    const [schema] = extractSchemas([items]);
    expect(schema!.rowCaption).toBe("stockLine");
    expect(schema!.computed).toEqual([
      {
        name: "onHand",
        label: "On hand",
        kind: "number",
        notes: "Units in stock.",
      },
      { name: "stockLine", label: "Stock line", kind: "text" },
      { name: "broken", label: "Broken", kind: "number" },
      {
        name: "parentPath",
        label: "Parent path",
        kind: "text",
        notes: "Labels of the row's ancestors, from the top down.",
      },
    ]);
  });

  it("documents each field's value in the OpenAPI spec", () => {
    const doc = api.generateDocument(
      { tables: [items] },
      { info: { title: "test", version: "1" } },
    ) as { paths: Record<string, Record<string, unknown>> };
    const text = JSON.stringify(doc.paths["/tables/items"]);
    expect(text).toContain("onHand");
    expect(text).toContain("Units in stock.");
  });
});

describe("sapportaTable computed field checks", () => {
  it("rejects a field named like a column", () => {
    expect(() =>
      sapportaTable({
        drizzle: itemsTable,
        meta: { rowLabelColumns: ["description"] },
        computed: {
          description: computedField({ kind: "text", load: () => new Map() }),
        },
      }),
    ).toThrow('computed field "description" has the name of a column');
  });

  it("rejects a reserved name", () => {
    expect(() =>
      sapportaTable({
        drizzle: itemsTable,
        meta: { rowLabelColumns: ["description"] },
        computed: {
          $total: computedField({ kind: "number", load: () => new Map() }),
        },
      }),
    ).toThrow("which Sapporta reserves");
  });

  it("rejects a caption that names nothing", () => {
    expect(() =>
      sapportaTable({
        drizzle: itemsTable,
        meta: { rowLabelColumns: ["description"], rowCaption: "nope" },
      }),
    ).toThrow('rowCaption names "nope"');
  });
});
