import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { RecordId } from "@sapporta/shared/record-id";
import { computedField, sapportaTable, treePath } from "../schema/table.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import { computeFields } from "./computed-fields.js";
import { scopedRows } from "./scoped-rows.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  parent_id: integer("parent_id").references(
    (): AnySQLiteColumn => accountsTable.id,
  ),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
});

type Batch = {
  ids: readonly RecordId[];
  once: <T>(key: string, compute: () => Promise<T>) => Promise<T>;
};

function byId<T>(ids: readonly RecordId[], value: (id: RecordId) => T) {
  return new Map(ids.map((id) => [id, value(id)]));
}

function setup(computed: Parameters<typeof sapportaTable>[0]["computed"]) {
  const accounts = sapportaTable({
    drizzle: accountsTable,
    meta: {
      rowLabelColumns: ["name"],
      tree: { parentColumn: "parent_id" },
    },
    computed,
  });
  const { sqlite, db } = createTestDb();
  sqlite.exec(`
    CREATE TABLE accounts (
      id integer PRIMARY KEY AUTOINCREMENT,
      name text NOT NULL,
      parent_id integer REFERENCES accounts(id),
      workspace_id text NOT NULL,
      scoped_to_user_id text NOT NULL
    );
  `);
  const auth = createTestAuthContext({ tables: [accounts] });
  const insert = sqlite.prepare(
    "INSERT INTO accounts (name, parent_id, workspace_id, scoped_to_user_id) VALUES (?, ?, 'workspace-1', ?)",
  );
  const add = (name: string, parent: number | null, user = "user-1") =>
    String(insert.run(name, parent, user).lastInsertRowid);
  return { accounts, db, auth, add };
}

describe("computeFields", () => {
  it("runs only the requested fields, once per batch", async () => {
    const runs: string[] = [];
    const { accounts, db, auth, add } = setup({
      a: computedField({
        kind: "number",
        load: ({ ids }) => {
          runs.push("a");
          return byId(ids, () => 1);
        },
      }),
      b: computedField({
        kind: "number",
        load: ({ ids }) => {
          runs.push("b");
          return byId(ids, () => 2);
        },
      }),
    });
    const one = add("One", null);
    const two = add("Two", null);
    const rows = await scopedRows(db, auth, accounts).findMany({ limit: 10 });

    const values = await computeFields({
      db,
      auth,
      table: accounts,
      ids: rows.map((row) => String(row.id)),
      names: ["a", "a"],
    });

    expect(values).toEqual({ a: { [one]: 1, [two]: 1 } });
    expect(runs).toEqual(["a"]);
  });

  it("shares work through once", async () => {
    let scans = 0;
    let onHandRuns = 0;
    function onHand(batch: Batch) {
      return batch.once("onHand", async () => {
        onHandRuns += 1;
        return byId(batch.ids, (id) => Number(id) * 10);
      });
    }
    const { accounts, db, auth, add } = setup({
      onHand: computedField({ kind: "number", load: onHand }),
      stockLine: computedField({
        kind: "text",
        load: async (batch) => {
          const values = await onHand(batch);
          return byId(batch.ids, (id) => `${String(values.get(id))} in stock`);
        },
      }),
      buy: computedField({
        kind: "json",
        load: async (batch) => (await volumes(batch)).buy,
      }),
      sell: computedField({
        kind: "json",
        load: async (batch) => (await volumes(batch)).sell,
      }),
    });
    function volumes(batch: Batch) {
      return batch.once("volumes", async () => {
        scans += 1;
        return {
          buy: byId(batch.ids, () => [1, 2]),
          sell: byId(batch.ids, () => [3]),
        };
      });
    }
    const id = add("One", null);

    const values = await computeFields({
      db,
      auth,
      table: accounts,
      ids: [id],
      names: ["stockLine", "onHand", "buy", "sell"],
    });

    expect(values).toEqual({
      stockLine: { [id]: "10 in stock" },
      onHand: { [id]: 10 },
      buy: { [id]: [1, 2] },
      sell: { [id]: [3] },
    });
    expect(onHandRuns).toBe(1);
    expect(scans).toBe(1);
  });

  it("fails when a loader leaves out an id", async () => {
    const { accounts, db, auth, add } = setup({
      partial: computedField({
        kind: "number",
        load: ({ ids }) => byId(ids.slice(1), () => 1),
      }),
    });
    const one = add("One", null);
    add("Two", null);
    const rows = await scopedRows(db, auth, accounts).findMany({ limit: 10 });

    await expect(
      computeFields({
        db,
        auth,
        table: accounts,
        ids: rows.map((row) => String(row.id)),
        names: ["partial"],
      }),
    ).rejects.toThrow(`returned no value for id(s) ${one}`);
  });

  it("checks values against the field's schema", async () => {
    const { accounts, db, auth, add } = setup({
      series: computedField({
        kind: "json",
        schema: z.array(z.number()),
        load: ({ ids }) => byId(ids, () => ["x"] as unknown as number[]),
      }),
    });
    const id = add("One", null);

    await expect(
      computeFields({
        db,
        auth,
        table: accounts,
        ids: [id],
        names: ["series"],
      }),
    ).rejects.toThrow("does not match its schema");
  });

  it("rejects an unknown name", async () => {
    const { accounts, db, auth } = setup({});

    await expect(
      computeFields({
        db,
        auth,
        table: accounts,
        ids: [],
        names: ["nope"],
      }),
    ).rejects.toThrow('has no computed field "nope"');
  });
});

describe("treePath", () => {
  it("joins the ancestors' labels from the top down", async () => {
    const { accounts, db, auth, add } = setup({
      parentPath: treePath(),
    });
    const expenses = add("Expenses", null);
    const kitchen = add("Kitchen", Number(expenses));
    const groceries = add("Groceries", Number(kitchen));

    const values = await computeFields({
      db,
      auth,
      table: accounts,
      ids: [groceries, kitchen, expenses],
      names: ["parentPath"],
    });

    expect(values.parentPath).toEqual({
      [groceries]: "Expenses > Kitchen",
      [kitchen]: "Expenses",
      [expenses]: null,
    });
  });

  it("stops at the nearest ancestor the request cannot see", async () => {
    const { accounts, db, auth, add } = setup({
      parentPath: treePath({ separator: " / " }),
    });
    const top = add("Top", null);
    const hidden = add("Hidden", Number(top), "user-2");
    const middle = add("Middle", Number(hidden));
    const leaf = add("Leaf", Number(middle));

    const values = await computeFields({
      db,
      auth,
      table: accounts,
      ids: [leaf, middle],
      names: ["parentPath"],
    });

    expect(values.parentPath).toEqual({ [leaf]: "Middle", [middle]: null });
  });
});
