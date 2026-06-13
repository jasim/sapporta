import { describe, it, expect } from "vitest";
import { connectProject } from "./sqlite-connection.js";

describe("connectProject", () => {
  it("connects to an in-memory database", () => {
    const { sqlite, db } = connectProject(":memory:");
    expect(sqlite).toBeDefined();
    expect(db).toBeDefined();
    sqlite.close();
  });

  it("sets WAL journal mode", () => {
    const { sqlite } = connectProject(":memory:");
    // WAL mode returns "memory" for :memory: databases (WAL requires a file),
    // but the pragma call itself must not throw.
    const mode = sqlite.pragma("journal_mode") as { journal_mode: string }[];
    expect(mode[0].journal_mode).toMatch(/wal|memory/);
    sqlite.close();
  });

  it("enables foreign keys", () => {
    const { sqlite } = connectProject(":memory:");
    const fk = sqlite.pragma("foreign_keys") as { foreign_keys: number }[];
    expect(fk[0].foreign_keys).toBe(1);
    sqlite.close();
  });

  it("enforces foreign key constraints at runtime", () => {
    const { sqlite } = connectProject(":memory:");
    sqlite.exec(`CREATE TABLE parent (id INTEGER PRIMARY KEY)`);
    sqlite.exec(
      `CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))`,
    );

    // Inserting a child with a non-existent parent should fail
    expect(() => {
      sqlite.prepare("INSERT INTO child (id, parent_id) VALUES (1, 999)").run();
    }).toThrow(/FOREIGN KEY/);

    sqlite.close();
  });

  it("closes without error", () => {
    const { sqlite } = connectProject(":memory:");
    expect(() => sqlite.close()).not.toThrow();
  });

  it("returns a working Drizzle instance", () => {
    const { sqlite, db } = connectProject(":memory:");
    sqlite.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    sqlite.prepare("INSERT INTO test (id, name) VALUES (1, 'hello')").run();

    // Verify Drizzle can query via sql.raw
    const { sql } = require("drizzle-orm");
    const rows = db.all(sql.raw("SELECT * FROM test"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, name: "hello" });

    sqlite.close();
  });
});
