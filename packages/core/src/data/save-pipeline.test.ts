import { describe, it, expect, beforeEach } from "vitest";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import { savePipeline, insertRow, updateRow } from "./save-pipeline.js";
import { ValidationError } from "../db/errors.js";
import { createTestDb } from "../testing/test-utils.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  balance: integer("balance"),
});

const accounts = table({
  drizzle: accountsTable,
  meta: {
    selects: [
      {
        type: "select",
        column: "type",
        options: ["asset", "liability", "equity", "revenue", "expense"],
      },
    ],
  },
});

describe("save-pipeline (integration)", () => {
  let db: any;

  beforeEach(async () => {
    const testDb = createTestDb();
    db = testDb.db;
    // Create the accounts table
    testDb.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance INTEGER
      )
    `);
  });

  it("inserts a valid record", async () => {
    const result = await savePipeline(accounts, db, {
      name: "Cash",
      type: "asset",
    });

    expect(result.id).toBe(1);
    expect(result.name).toBe("Cash");
    expect(result.type).toBe("asset");
  });

  it("rejects invalid records", async () => {
    await expect(
      savePipeline(accounts, db, { name: "Bad", type: "invalid_type" }),
    ).rejects.toThrow(ValidationError);
  });

  it("updates an existing record", async () => {
    const inserted = await insertRow(accounts, db, {
      name: "Cash",
      type: "asset",
    });

    const updated = await savePipeline(
      accounts,
      db,
      { name: "Cash on Hand", type: "asset" },
      String(inserted.id),
    );

    expect(updated.name).toBe("Cash on Hand");
    expect(updated.id).toBe(inserted.id);
  });

  it("rejects control characters in string values", async () => {
    await expect(
      savePipeline(accounts, db, { name: "Cash\x00", type: "asset" }),
    ).rejects.toThrow(ValidationError);

    try {
      await savePipeline(accounts, db, { name: "Cash\x07", type: "asset" });
    } catch (e: any) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.errors[0].field).toBe("name");
      expect(e.errors[0].message).toContain("control characters");
    }
  });

  it("rejects unknown columns", async () => {
    await expect(
      savePipeline(accounts, db, {
        name: "Cash",
        type: "asset",
        bogus: "should fail",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("updates a single field without requiring all columns", async () => {
    const inserted = await insertRow(accounts, db, {
      name: "Cash",
      type: "asset",
    });

    const updated = await savePipeline(
      accounts,
      db,
      { name: "Petty Cash" },
      String(inserted.id),
    );

    expect(updated.name).toBe("Petty Cash");
    expect(updated.type).toBe("asset");
  });

  it("insertRow and updateRow work directly", async () => {
    const row = await insertRow(accounts, db, {
      name: "Revenue",
      type: "revenue",
    });
    expect(row.id).toBeDefined();

    const updated = await updateRow(accounts, db, String(row.id), {
      name: "Sales Revenue",
    });
    expect(updated.name).toBe("Sales Revenue");
  });
});
