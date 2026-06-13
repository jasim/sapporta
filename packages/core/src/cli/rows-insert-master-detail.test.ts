import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { rowsInsertMasterDetail } from "./rows-insert-master-detail.js";
import type { SqlClient } from "../introspect/types.js";

/**
 * Create a SqlClient adapter from a better-sqlite3 Database.
 *
 * The returned object is both a SqlClient (for rowsInsertMasterDetail's type
 * signature) and a Database.Database proxy (for the `sql as any` casts inside
 * rowsInsertMasterDetail that pass it to synchronous db-helpers functions).
 *
 * begin() wraps the callback in a SQLite transaction using SAVEPOINT for
 * nested transaction semantics. The transaction SqlClient passed to the
 * callback also carries the sqlite handle's native methods.
 */
function createTestSql(
  sqlite: Database.Database,
): SqlClient & Database.Database {
  const extended = sqlite as any;
  extended.unsafe = (query: string, params?: any[]) => {
    return Promise.resolve(sqlite.prepare(query).all(...(params ?? [])));
  };
  extended.begin = async (fn: (tx: SqlClient) => Promise<any>) => {
    sqlite.exec("BEGIN");
    try {
      const txExtended = sqlite as any;
      // tx.unsafe is already on the sqlite handle from the outer assignment
      const result = await fn(txExtended);
      sqlite.exec("COMMIT");
      return result;
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  };
  extended.end = async () => {};
  return extended;
}

describe("rows insert-master-detail", () => {
  let sqlite: Database.Database;
  let sql: SqlClient;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sql = createTestSql(sqlite);
    sqlite.exec(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT NOT NULL
      );
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product TEXT NOT NULL,
        quantity INTEGER NOT NULL
      );
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("inserts master and detail rows atomically", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await rowsInsertMasterDetail(sql, {
      "master-table": "orders",
      "master-data": '{"customer":"Alice"}',
      "detail-table": "order_items",
      "detail-data":
        '[{"product":"Widget","quantity":3},{"product":"Gadget","quantity":1}]',
      "detail-fk": "order_id",
    });

    const orders = sqlite.prepare("SELECT * FROM orders").all() as any[];
    expect(orders).toHaveLength(1);
    expect(orders[0].customer).toBe("Alice");

    const items = sqlite
      .prepare("SELECT * FROM order_items ORDER BY id")
      .all() as any[];
    expect(items).toHaveLength(2);
    expect(items[0].order_id).toBe(1);
    expect(items[0].product).toBe("Widget");
    expect(items[1].order_id).toBe(1);
    expect(items[1].product).toBe("Gadget");

    log.mockRestore();
  });

  it("backfills FK column from master ID", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await rowsInsertMasterDetail(sql, {
      "master-table": "orders",
      "master-data": '{"customer":"Bob"}',
      "detail-table": "order_items",
      "detail-data": '[{"product":"Thing","quantity":5}]',
      "detail-fk": "order_id",
    });

    const items = sqlite.prepare("SELECT * FROM order_items").all() as any[];
    expect(items[0].order_id).toBe(1);

    log.mockRestore();
  });

  it("throws when required flags are missing", async () => {
    await expect(
      rowsInsertMasterDetail(sql, { "master-table": "orders" }),
    ).rejects.toThrow("Usage:");
  });

  it("rejects invalid table names", async () => {
    await expect(
      rowsInsertMasterDetail(sql, {
        "master-table": "orders; DROP TABLE orders;--",
        "master-data": '{"customer":"x"}',
        "detail-table": "order_items",
        "detail-data": "[{}]",
        "detail-fk": "order_id",
      }),
    ).rejects.toThrow("Invalid table name");
  });
});
