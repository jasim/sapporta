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

/**
 * SQLite ships no time zone database, so `connectProject` supplies Node's.
 * These cover what a report depends on: the day is the local day, a day that
 * runs 23 or 25 hours still holds exactly its own rows, a missing timestamp
 * has no day, and the function cannot be written into the database file.
 */
describe("to_tz_date", () => {
  function day(instant: string | null, zone: string): unknown {
    const { sqlite } = connectProject(":memory:");
    try {
      const row = sqlite
        .prepare("SELECT to_tz_date(?, ?) AS day")
        .get(instant, zone) as { day: unknown };
      return row.day;
    } finally {
      sqlite.close();
    }
  }

  it("buckets an instant by the day it falls on in the named zone", () => {
    // Half past nine at night in London is two in the morning in Kolkata, on
    // the next day.
    expect(day("2026-08-23T21:30:00Z", "UTC")).toBe("2026-08-23");
    expect(day("2026-08-23T21:30:00Z", "Asia/Kolkata")).toBe("2026-08-24");
    expect(day("2026-08-23T02:30:00Z", "America/New_York")).toBe("2026-08-22");
  });

  it("gives a missing timestamp no day", () => {
    // `new Date(null)` is the epoch, so the naive implementation would answer
    // 1970-01-01 and a nullable column would grow a silent bucket.
    expect(day(null, "UTC")).toBeNull();
  });

  it("refuses a zone this runtime does not know", () => {
    expect(() => day("2026-08-23T21:30:00Z", "Mars/Olympus_Mons")).toThrow(
      /Mars\/Olympus_Mons/,
    );
  });

  it("refuses a stored value that is not an instant", () => {
    expect(() => day("2026-02-30T00:00:00Z", "UTC")).toThrow();
  });

  it("counts the rows of a 23-hour and a 25-hour day", () => {
    const { sqlite } = connectProject(":memory:");
    try {
      sqlite.exec("CREATE TABLE ticks (at TEXT NOT NULL)");
      const insert = sqlite.prepare("INSERT INTO ticks (at) VALUES (?)");
      // Every hour across both 2026 transitions in New York: the clock springs
      // forward on March 8 and falls back on November 1.
      for (const start of ["2026-03-06T00:00:00Z", "2026-10-30T00:00:00Z"]) {
        const from = Date.parse(start);
        for (let hour = 0; hour < 24 * 6; hour += 1) {
          insert.run(
            new Date(from + hour * 3_600_000)
              .toISOString()
              .replace(/\.\d+Z$/, "Z"),
          );
        }
      }

      const rows = sqlite
        .prepare(
          `SELECT to_tz_date(at, ?) AS day, count(*) AS n
           FROM ticks GROUP BY day ORDER BY day`,
        )
        .all("America/New_York") as { day: string; n: number }[];
      const counts = new Map(rows.map((row) => [row.day, row.n]));

      expect(counts.get("2026-03-07")).toBe(24);
      expect(counts.get("2026-03-08")).toBe(23);
      expect(counts.get("2026-03-09")).toBe(24);
      expect(counts.get("2026-10-31")).toBe(24);
      expect(counts.get("2026-11-01")).toBe(25);
      expect(counts.get("2026-11-02")).toBe(24);
    } finally {
      sqlite.close();
    }
  });

  /**
   * An expression index over this function would record it in the database
   * file, and from then on only a process that had registered a JavaScript
   * function of that name could write to it — no sqlite3 shell, no backup
   * tool, not even `PRAGMA integrity_check`. `directOnly` makes that an error
   * where the mistake is, at `CREATE INDEX`.
   */
  it("cannot be written into the database file", () => {
    const { sqlite } = connectProject(":memory:");
    try {
      sqlite.exec("CREATE TABLE ticks (at TEXT NOT NULL)");
      expect(() =>
        sqlite.exec(
          "CREATE INDEX ticks_day ON ticks(to_tz_date(at, 'Asia/Kolkata'))",
        ),
      ).toThrow(/unsafe use of to_tz_date/);
    } finally {
      sqlite.close();
    }
  });
});
