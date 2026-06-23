import { describe, it, expect } from "vitest";
import {
  sqliteTable,
  text,
  integer,
  SQLiteSyncDialect,
} from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { timestamp } from "../schema/table.js";
import { sapportaTable } from "../schema/table.js";
import { parseQuery } from "./query-parser.js";

const dialect = new SQLiteSyncDialect();
const toSql = (s: SQL | undefined) => (s ? dialect.sqlToQuery(s).sql : "");
const compile = (s: SQL | undefined) => {
  if (!s) throw new Error("expected SQL fragment, got undefined");
  const q = dialect.sqlToQuery(s);
  return { sql: q.sql, params: q.params };
};

const ordersTable = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer: text("customer").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull(),
  created_at: timestamp("created_at").notNull(),
});

const orders = sapportaTable({
  drizzle: ordersTable,
  meta: { rowLabelColumns: ["customer"] },
});
const searchableOrders = sapportaTable({
  drizzle: ordersTable,
  meta: {
    rowLabelColumns: ["customer"],
    search: { columns: ["customer", "status"] },
  },
});
const singleSearchOrders = sapportaTable({
  drizzle: ordersTable,
  meta: { rowLabelColumns: ["customer"], search: { columns: ["customer"] } },
});
const badSearchTable = sapportaTable({
  drizzle: ordersTable,
  meta: { rowLabelColumns: ["customer"], search: { columns: ["nope"] } },
});

describe("parseQuery()", () => {
  it("defaults to page 1, limit 50", () => {
    const q = parseQuery({}, orders);
    expect(q.limit).toBe(50);
    expect(q.offset).toBe(0);
    expect(q.where).toBeUndefined();
    expect(q.orderBy).toEqual([]);
  });

  it("parses page and limit", () => {
    const q = parseQuery({ page: "3", limit: "25" }, orders);
    expect(q.limit).toBe(25);
    expect(q.offset).toBe(50); // (3-1) * 25
  });

  // ── Filter operators ─────────────────────────────────────────────────

  describe("filter operators", () => {
    it("parses eq", () => {
      const q = parseQuery({ "filter[status][eq]": "paid" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."status" = ?');
      expect(params).toEqual(["paid"]);
    });

    it("parses neq", () => {
      const q = parseQuery({ "filter[status][neq]": "paid" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."status" <> ?');
      expect(params).toEqual(["paid"]);
    });

    it("parses ordinal operators", () => {
      for (const [op, glyph] of [
        ["gt", ">"],
        ["gte", ">="],
        ["lt", "<"],
        ["lte", "<="],
      ]) {
        const q = parseQuery({ [`filter[amount][${op}]`]: "100" }, orders);
        const { sql, params } = compile(q.where);
        expect(sql).toBe(`"orders"."amount" ${glyph} ?`);
        // The typed boundary parses numeric-column values to numbers before
        // they reach Drizzle — strings stopped being legal for gt/lt/gte/lte.
        expect(params).toEqual([100]);
      }
    });

    it("parses in with CSV values", () => {
      const q = parseQuery(
        { "filter[status][in]": "paid,void,refunded" },
        orders,
      );
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."status" in (?, ?, ?)');
      expect(params).toEqual(["paid", "void", "refunded"]);
    });

    it("parses nin with CSV values", () => {
      const q = parseQuery({ "filter[status][nin]": "paid,void" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."status" not in (?, ?)');
      expect(params).toEqual(["paid", "void"]);
    });

    it("contains wraps value with %...% and escapes LIKE wildcards", () => {
      const q = parseQuery({ "filter[customer][contains]": "50%_off" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe(`"orders"."customer" LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(["%50\\%\\_off%"]);
    });

    it("startswith anchors to the beginning", () => {
      const q = parseQuery({ "filter[customer][startswith]": "Acme" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe(`"orders"."customer" LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(["Acme%"]);
    });

    it("endswith anchors to the end", () => {
      const q = parseQuery({ "filter[customer][endswith]": "Inc" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe(`"orders"."customer" LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(["%Inc"]);
    });

    it("escapes backslashes in substring values", () => {
      const q = parseQuery({ "filter[customer][contains]": "a\\b" }, orders);
      const { params } = compile(q.where);
      expect(params).toEqual(["%a\\\\b%"]);
    });

    it("is=null → IS NULL", () => {
      const q = parseQuery({ "filter[amount][is]": "null" }, orders);
      expect(toSql(q.where)).toBe('"orders"."amount" is null');
    });

    it("is=notnull → IS NOT NULL", () => {
      const q = parseQuery({ "filter[amount][is]": "notnull" }, orders);
      expect(toSql(q.where)).toBe('"orders"."amount" is not null');
    });
  });

  // ── Sort ─────────────────────────────────────────────────────────────

  describe("sort", () => {
    it("parses ascending", () => {
      const q = parseQuery({ sort: "customer" }, orders);
      expect(q.orderBy).toHaveLength(1);
      expect(toSql(q.orderBy[0])).toMatch(/"customer" asc/i);
    });

    it("parses descending", () => {
      const q = parseQuery({ sort: "-created_at" }, orders);
      expect(q.orderBy).toHaveLength(1);
      expect(toSql(q.orderBy[0])).toMatch(/"created_at" desc/i);
    });

    it("parses multiple fields", () => {
      const q = parseQuery({ sort: "-amount,customer" }, orders);
      expect(q.orderBy).toHaveLength(2);
    });
  });

  // ── Errors ───────────────────────────────────────────────────────────

  describe("errors", () => {
    it("unknown_filter_shape — filter[col] without [op]", () => {
      expect(() => parseQuery({ "filter[status]": "paid" }, orders)).toThrow(
        expect.objectContaining({ code: "unknown_filter_shape" }),
      );
    });

    it("unknown_filter_shape — nested beyond two brackets", () => {
      expect(() =>
        parseQuery({ "filter[status][eq][extra]": "x" }, orders),
      ).toThrow(expect.objectContaining({ code: "unknown_filter_shape" }));
    });

    it("unknown_column — filter references missing column", () => {
      expect(() =>
        parseQuery({ "filter[naration][eq]": "foo" }, orders),
      ).toThrow(expect.objectContaining({ code: "unknown_column" }));
    });

    it("unknown_column — sort references missing column", () => {
      expect(() => parseQuery({ sort: "unknown" }, orders)).toThrow(
        expect.objectContaining({ code: "unknown_column" }),
      );
    });

    it("unknown_op — op not in the supported set", () => {
      expect(() =>
        parseQuery({ "filter[status][like]": "paid" }, orders),
      ).toThrow(expect.objectContaining({ code: "unknown_op" }));
    });

    it("bad_value — is= with value other than null/notnull", () => {
      expect(() =>
        parseQuery({ "filter[amount][is]": "empty" }, orders),
      ).toThrow(expect.objectContaining({ code: "bad_value" }));
    });

    it("bad_value — in= empty", () => {
      expect(() => parseQuery({ "filter[status][in]": "" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_value" }),
      );
    });

    it("bad_value — in= with empty item (trailing comma)", () => {
      expect(() =>
        parseQuery({ "filter[status][in]": "paid,,void" }, orders),
      ).toThrow(expect.objectContaining({ code: "bad_value" }));
    });

    it("bad_limit — above cap", () => {
      expect(() => parseQuery({ limit: "5000" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_limit" }),
      );
    });

    it("bad_limit — zero", () => {
      expect(() => parseQuery({ limit: "0" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_limit" }),
      );
    });

    it("bad_limit — non-numeric", () => {
      expect(() => parseQuery({ limit: "abc" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_limit" }),
      );
    });

    it("bad_page — non-numeric", () => {
      expect(() => parseQuery({ page: "abc" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_page" }),
      );
    });

    it("bad_page — zero", () => {
      expect(() => parseQuery({ page: "0" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_page" }),
      );
    });
  });

  // ── Cross-column search (q) — unchanged from pre-redesign ────────────

  describe("cross-column search (q)", () => {
    it("builds an OR across exactly the configured search columns, parameterized", () => {
      const q = parseQuery({ q: "foo" }, searchableOrders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe(
        '("orders"."customer" like ? or "orders"."status" like ?)',
      );
      expect(params).toEqual(["%foo%", "%foo%"]);
    });

    it("does not interpolate qTerm into SQL text (parameter binding)", () => {
      const qTerm = "' OR 1=1 --";
      const q = parseQuery({ q: qTerm }, searchableOrders);
      const { sql, params } = compile(q.where);
      expect(sql).not.toContain(qTerm);
      expect(sql).not.toContain("OR 1=1");
      expect(params).toEqual([`%${qTerm}%`, `%${qTerm}%`]);
    });

    it("omits the OR wrapper when only one search column is configured", () => {
      const q = parseQuery({ q: "foo" }, singleSearchOrders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."customer" like ?');
      expect(sql).not.toMatch(/ or /i);
      expect(params).toEqual(["%foo%"]);
    });

    it("passes LIKE wildcards in qTerm through verbatim", () => {
      const q = parseQuery({ q: "10%_foo" }, singleSearchOrders);
      const { params } = compile(q.where);
      expect(params).toEqual(["%10%_foo%"]);
    });

    it("AND-s the search OR-group with filter predicates", () => {
      const q = parseQuery(
        { q: "foo", "filter[status][eq]": "paid" },
        searchableOrders,
      );
      const { sql, params } = compile(q.where);
      expect(sql).toBe(
        '("orders"."status" = ? and ("orders"."customer" like ? or "orders"."status" like ?))',
      );
      expect(params).toEqual(["paid", "%foo%", "%foo%"]);
    });

    it("composes with sort and pagination", () => {
      const q = parseQuery(
        { q: "foo", sort: "-created_at", page: "2", limit: "25" },
        searchableOrders,
      );
      const { params } = compile(q.where);
      expect(params).toEqual(["%foo%", "%foo%"]);
      expect(q.orderBy).toHaveLength(1);
      expect(toSql(q.orderBy[0])).toMatch(/"created_at" desc/i);
      expect(q.limit).toBe(25);
      expect(q.offset).toBe(25);
    });

    it("treats empty q as absent (no predicate, no error)", () => {
      const q = parseQuery({ q: "" }, searchableOrders);
      expect(q.where).toBeUndefined();
    });

    it("treats whitespace-only q as absent", () => {
      const q = parseQuery({ q: "   " }, searchableOrders);
      expect(q.where).toBeUndefined();
    });

    it("throws no_search_config when q is set but meta.search is missing", () => {
      expect(() => parseQuery({ q: "foo" }, orders)).toThrow(
        expect.objectContaining({ code: "no_search_config" }),
      );
    });

    it("throws unknown_search_column when a configured column doesn't exist", () => {
      expect(() => parseQuery({ q: "foo" }, badSearchTable)).toThrow(
        expect.objectContaining({ code: "unknown_search_column" }),
      );
    });
  });
});
