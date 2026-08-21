import { describe, it, expect, beforeEach } from "vitest";
import {
  customType,
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../schema/table.js";
import { savePipeline, insertRow, updateRow } from "./save-pipeline.js";
import { ValidationError } from "../errors.js";
import { createTestDb } from "../testing/test-utils.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["asset", "liability", "equity", "revenue", "expense"],
  }).notNull(),
  balance: integer("balance"),
});

const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: {
    rowLabelColumns: ["name"],
  },
});

describe("save-pipeline (integration)", () => {
  let db: ReturnType<typeof createTestDb>["db"];

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
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ValidationError);
      if (!(e instanceof ValidationError)) throw e;
      expect(e.errors[0]!.field).toBe("name");
      expect(e.errors[0]!.message).toContain("control characters");
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

  it("passes parsed transform output to Drizzle and returns SQL field names", async () => {
    let receivedByDrizzle: unknown;
    const capturedTimestamp = customType<{
      data: string;
      driverData: string;
    }>({
      dataType: () => "text",
      toDriver(value) {
        receivedByDrizzle = value;
        return value;
      },
      fromDriver: (value) => value,
    });
    const eventsTable = sqliteTable("events", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      eventName: text("event_name").notNull(),
      startsAt: capturedTimestamp("starts_at").notNull(),
    });
    const events = sapportaTable({
      drizzle: eventsTable,
      meta: {
        rowLabelColumns: ["event_name"],
        rowScope: "systemGlobal",
        columns: { starts_at: { kind: "timestamp" } },
      },
    });
    const testDb = createTestDb();
    testDb.sqlite.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_name TEXT NOT NULL,
        starts_at TEXT NOT NULL
      )
    `);

    const row = await savePipeline(events, testDb.db, {
      event_name: "Launch",
      starts_at: "2026-07-18T10:30:45.999+05:30",
    });

    expect(receivedByDrizzle).toBe("2026-07-18T05:00:45Z");
    expect(row).toEqual({
      id: 1,
      event_name: "Launch",
      starts_at: "2026-07-18T05:00:45Z",
    });
  });
});
